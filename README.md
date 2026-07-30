# Project Zomboid Server Manager

**Idiomas:** [Español](README.md) · [English](README.en.md) · [Deutsch](README.de.md)

Panel web para instalar, actualizar y operar un servidor dedicado de Project
Zomboid: mods de Steam Workshop (incluyendo colecciones completas), ajustes de
sandbox, consola RCON, jugadores conectados, backups del mundo, y un registro
de auditoría de acciones administrativas.

## Funcionalidades

- **Servidor**: instalar/actualizar vía SteamCMD (con selección de **rama/
  build**: estable, `unstable`, `iwillbackupmysave`, o cualquier otra vía
  `-beta`), iniciar/detener/reiniciar, estado en vivo.
- **Jugadores**: lista de conectados vía RCON, kick/ban/unban.
- **Consola RCON**: terminal con historial (↑/↓) para cualquier comando.
- **Mods**: instalar por ID de Workshop o importar una **colección completa**
  (resuelve automáticamente cada ítem vía la Steam Web API) y detecta
  dependencias (`Require=`) que faltan por instalar. `Mods=`/`WorkshopItems=`/
  `RCONPort=`/`RCONPassword=`/`MaxPlayers=` se escriben automáticamente en el
  `.ini` real antes de cada arranque y tras cualquier cambio de mods — nunca
  quedan sólo en la base de datos del panel.
- **Server Settings**: editor genérico del resto del `.ini` real (mapa,
  contraseña de acceso, visibilidad, PVP, máximo de jugadores, lo que exista
  en el archivo) con controles tipados, excluyendo las claves gestionadas
  automáticamente arriba.
- **Sandbox**: editor categorizado de `SandboxVars.lua` (checkboxes/números/
  texto según el tipo real de cada ajuste) en vez de editar Lua a mano.
- **Config**: editor de archivos crudo (ini/lua) con alcance restringido al
  directorio de datos, para cualquier cosa que los editores estructurados no
  cubran.
- **Backups**: snapshots manuales y programados del mundo (`tar.gz`), listar/
  restaurar/eliminar, con snapshot automático antes de instalar mods, importar
  colecciones, actualizar el servidor o restaurar otro backup.
- **Auditoría**: quién hizo qué y cuándo (inicio/parada, cambios de config,
  mods, backups, factory reset).
- **Métricas**: CPU/RAM en vivo (leídas de cgroup v2, igual que un panel real
  de hosting; con fallback vía `os` en desarrollo local), gráfico con historial
  en cliente (últimas 30 muestras, sondeo cada 2s), leyenda, crosshair+tooltip
  y vista de tabla.
- **Logs**: streaming en vivo por SSE.
- **Consola de actividad**: cajón inferior, visible desde cualquier página,
  que muestra cada llamada API del frontend (método, ruta, status, duración)
  entrelazada con el stream de logs en vivo del backend — para responder
  "¿pasó algo al presionar ese botón?" sin tener que ir a la pestaña Logs.

## Arquitectura

| Capa | Tecnología |
|---|---|
| Frontend | React 19 + Vite, salida estática |
| Proxy web | Nginx Alpine |
| Backend | Node.js 24 + Fastify + TypeScript |
| Estado | SQLite (better-sqlite3) |
| Configuración | TOML |
| Contenedores | Podman |
| Despliegue | Node/TypeScript, SSH y Podman remoto |

```text
backend/src/
├── config/     lectura y validación TOML
├── domain/     ServerPaths, StartupSettings, mods de Workshop, SandboxVars.lua,
│               server.ini genérico + sincronización de claves gestionadas,
│               colecciones de Steam, lista de jugadores
├── infra/      SQLite, LogHub (buffer + SSE), factory reset, backups (tar.gz),
│               registro de auditoría, sampler de métricas (cgroup v2)
├── process/    RuntimeState (proceso del servidor), SteamCmdRunner, cliente RCON
├── routes/     endpoints Fastify (auth, server, mods, files, sandbox,
│               server-settings, backups, audit, metrics, system)
├── security/   hashing de contraseña, sesión firmada (HMAC)
└── app.ts / server.ts

frontend/src/
├── api/                cliente fetch + guardia de autenticación + pub-sub de actividad API
├── ActivityConsole.tsx cajón de consola global (llamadas API + logs del backend)
└── sections/           Dashboard, Metrics (+ MetricsChart), Players, Console, Mods,
                        Server Settings, Sandbox, Config, Logs, Backups, Audit,
                        Settings, System

deploy/         script de despliegue remoto (equivalente TS de deploy.py)
```

## Configuración

### Instalación rápida

Requisitos:

- Node.js 24 o superior (`node --version`).
- Podman y `podman compose` para ejecutar la instalación completa.

Desde la raíz del proyecto:

```bash
npm install
npm run setup
```

`npm run setup` crea `config/manager.secrets.toml` con secretos aleatorios,
permisos privados y una contraseña inicial para el usuario `admin`. Guarda la
contraseña que aparece en la terminal; el instalador no sobrescribe un archivo
de secretos existente.

Después, inicia los contenedores:

```bash
podman compose -f podman-compose.yml up -d --build
```

Abre `http://127.0.0.1:8080`. La configuración incluida realiza instalaciones
reales. Para desarrollo sin descargar el servidor, cambia `mock_steamcmd` y
`mock_server_binary` a `true` en `config/manager.toml`; la interfaz marcará
claramente que esas acciones son simuladas.

En Windows PowerShell, si la política de ejecución bloquea `npm.ps1`, usa
`npm.cmd` en los mismos comandos:

```powershell
npm.cmd install
npm.cmd run setup
podman compose -f podman-compose.yml up -d --build
```

### Configuración manual

1. Edita `config/manager.toml` para puertos, red, rutas y límites.
2. Si no usaste `npm run setup`, crea el archivo privado:

```bash
cp config/manager.secrets.example.toml config/manager.secrets.toml
chmod 600 config/manager.secrets.toml
```

3. Reemplaza la contraseña del panel y el secreto de sesión.

Genera un secreto de sesión con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`manager.secrets.toml` está ignorado por Git y nunca se copia dentro de una
imagen. Durante el despliegue se transfiere por SCP y se monta como solo
lectura.

SQLite se conserva en `<zomboid_data_dir>/manager.sqlite3` y almacena
credenciales del panel y la lista de mods activa. Los archivos grandes
(instalación del servidor, `~/Zomboid`, SteamCMD) continúan en volúmenes
dedicados.

### Secciones principales

- `[web]`: puerto interno, puerto público, bind, usuario del panel.
- `[server]`: directorios de instalación/datos/SteamCMD, nombre del
  servidor, `public_address` opcional (IP pública o DNS mostrado para unirse),
  puertos de juego y RCON, límite de memoria.

El usuario administrador integrado del juego se llama `admin`. Su contraseña
se define como `server.admin_password` en `config/manager.secrets.toml` y se
pasa con `-adminpassword` para que el primer arranque no dependa de una consola
interactiva.

El proceso se inicia con `-cachedir=<zomboid_data_dir>` para que mundos,
usuarios, logs y archivos `Server/*.ini`/`SandboxVars.lua` vivan en el volumen
persistente que administra el panel, en lugar del directorio personal efímero
del contenedor.
- `[steam]`: lista opcional de Steam IDs autorizados (login de panel).
- `[runtime]`: zona horaria y flags `mock_*` para desarrollo sin SteamCMD ni
  binario real del servidor.
- `[backups]`: directorio de backups, cuántos backups programados conservar,
  e intervalo en horas del backup programado (`0` lo desactiva; los backups
  manuales siempre funcionan).

Para red host utiliza `config/manager.host.toml` con el overlay
`podman-compose.host.yml`.

## Desarrollo

Requisitos: Node.js 24. Podman sólo es necesario para probar contenedores.

```bash
npm install
npm run setup           # sólo la primera vez
npm run dev:backend    # Fastify con recarga (tsx watch)
npm run dev:frontend   # Vite dev server, proxy /api hacia el backend
```

Ejecuta backend y frontend en dos terminales. Abre
`http://127.0.0.1:5173`; Vite redirige `/api` a
`http://127.0.0.1:8080`.

Build y tests:

```bash
npm run build:backend
npm run build:frontend
npm test               # backend + frontend + deploy
```

## Podman local

```bash
podman compose -f podman-compose.yml up -d --build
podman compose -f podman-compose.yml ps
podman compose -f podman-compose.yml logs --tail 200
```

Modo host:

```bash
podman compose -f podman-compose.yml -f podman-compose.host.yml up -d --build
```

Volúmenes persistentes: `pz-install`, `pz-data`, `pz-steamcmd`, `pz-backups`.
Eliminar o recrear contenedores no elimina estos volúmenes.

### Verificar la instalación del servidor

El Dashboard no considera terminada una instalación sólo porque SteamCMD
devuelva código `0`. Verifica tanto `start-server.sh` como
`steamapps/appmanifest_380870.acf` dentro del volumen de instalación y muestra
el `buildid` de Steam. Si aparece **No real build installed (simulation)**,
`mock_steamcmd` sigue activo y no se descargó ningún archivo.

El servidor dedicado de Project Zomboid (Steam App ID `380870`) se instala con
`+login anonymous`; no requiere una cuenta que posea el juego. Esto es distinto
del flujo del panel de Arma 3, que mantiene una sesión SteamCMD interactiva con
Steam Guard. Las credenciales de `[steam]` quedan reservadas para casos
excepcionales y no son necesarias para instalar el servidor base.

### Restablecimiento total desde la API

El endpoint autenticado `POST /api/system/factory-reset` elimina todo el
contenido persistente: instalación del servidor, `~/Zomboid`, mods
descargados de Workshop, SQLite, estado de SteamCMD y todos los backups.
Requiere que el servidor de juego esté detenido.

```json
{
  "currentPassword": "contraseña-actual-del-panel",
  "confirmation": "RESET ALL ZOMBOID DATA"
}
```

La solicitud escribe un marcador atómico y reinicia el proceso. El backend
vacía los volúmenes persistentes al arrancar, antes de abrir SQLite, y sólo
elimina el marcador cuando todas las operaciones terminan correctamente. Si
el proceso se interrumpe, el siguiente arranque vuelve a intentarlo.

## Despliegue remoto

```bash
cp deploy.example.toml deploy.toml
```

```toml
[dev]
server = "192.168.1.20"
username = "pz"

[prod]
server = "203.0.113.20"
username = "pz"
```

Despliegues selectivos:

```bash
npx tsx deploy/deploy.ts dev --check
npx tsx deploy/deploy.ts dev --frontend
npx tsx deploy/deploy.ts dev --backend
npx tsx deploy/deploy.ts prod --frontend --backend --yes
```

Operación remota:

```bash
npx tsx deploy/deploy.ts prod --status
npx tsx deploy/deploy.ts prod --logs api
npx tsx deploy/deploy.ts prod --logs frontend
```

El script:

1. valida TOML, SSH, tar, scp y conectividad Podman;
2. transfiere una release sin secretos ni artefactos (tar sobre SSH);
3. transfiere `manager.secrets.toml` por separado con `chmod 600`;
4. construye sólo la imagen solicitada en el servidor remoto;
5. conserva volúmenes;
6. reemplaza únicamente el contenedor seleccionado con `podman run --replace`;
7. espera el health check y hace rollback automático a la imagen anterior si
   falla;
8. reinicia el frontend tras un deploy exclusivo del backend;
9. elimina imágenes antiguas sin contenedor sólo si llevan la etiqueta
   `project=pz-manager`.

Actualizar el backend detiene el proceso de Project Zomboid porque vive en el
mismo contenedor. Por eso requiere confirmación (`DEPLOY`) o `--yes`.

## API y seguridad

- `/api/health` es público para health checks.
- `/api/auth/*` administra sesiones (cookie firmada con HMAC-SHA256, sin
  almacenamiento de sesión en servidor).
- El resto de `/api/*` requiere autenticación.
- El editor de archivos restringe rutas al directorio de datos de Zomboid.
- Las contraseñas se derivan con `scrypt`.
- Las credenciales de SteamCMD se redactan en los logs de comandos.
- `POST /api/workshop/install-collection` resuelve una colección de Steam
  Workshop vía `ISteamRemoteStorage/GetCollectionDetails` (sin API key) y
  descarga cada ítem con SteamCMD.
- Todas las acciones administrativas (start/stop, mods, sandbox, backups,
  factory reset) quedan en `GET /api/audit`.

## Verificación antes de producción

```bash
npm run build:backend
npm run build:frontend
npm test
podman build -f Containerfile.api -t pz-manager-api:test .
podman build -f Containerfile.frontend -t pz-manager-frontend:test .
```
