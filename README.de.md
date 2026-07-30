# Project Zomboid Server Manager

**Sprachen:** [Español](README.md) · [English](README.en.md) · [Deutsch](README.de.md)

Web-Panel zum Installieren, Aktualisieren und Betreiben eines dedizierten
Project-Zomboid-Servers: Steam-Workshop-Mods (einschließlich vollständiger
Kollektionen), Sandbox-Einstellungen, RCON-Konsole, verbundene Spieler,
Welt-Backups und ein Audit-Protokoll administrativer Aktionen.

## Funktionen

- **Server**: Installation/Aktualisierung über SteamCMD (mit Auswahl von
  **Branch/Build**: stable, `unstable`, `iwillbackupmysave` oder jeder
  andere über `-beta`), Start/Stopp/Neustart, Live-Status.
- **Spieler**: Liste der verbundenen Spieler über RCON, Kick/Bann/Entbannen.
- **RCON-Konsole**: Terminal mit Verlauf (↑/↓) für beliebige Befehle.
- **Mods**: Installation per Workshop-ID oder Import einer **kompletten
  Kollektion** (löst automatisch jedes Element über die Steam Web API auf)
  und erkennt fehlende Abhängigkeiten (`Require=`). `Mods=`/`WorkshopItems=`/
  `RCONPort=`/`RCONPassword=`/`MaxPlayers=` werden automatisch vor jedem
  Start und nach jeder Mod-Änderung in die echte `.ini`-Datei geschrieben —
  sie verbleiben nie nur in der Datenbank des Panels.
- **Server Settings**: generischer Editor für den Rest der echten `.ini`
  (Karte, Beitrittspasswort, Sichtbarkeit, PVP, maximale Spielerzahl, was
  auch immer in der Datei existiert) mit typisierten Steuerelementen,
  ausgenommen die oben automatisch verwalteten Schlüssel.
- **Sandbox**: kategorisierter Editor für `SandboxVars.lua` (Checkboxen/
  Zahlen/Text je nach tatsächlichem Typ jeder Einstellung) statt manueller
  Lua-Bearbeitung.
- **Config**: Rohdatei-Editor (ini/lua), beschränkt auf das Datenverzeichnis,
  für alles, was die strukturierten Editoren nicht abdecken.
- **Backups**: manuelle und geplante Welt-Snapshots (`tar.gz`), Auflisten/
  Wiederherstellen/Löschen, mit automatischem Snapshot vor der Mod-
  Installation, dem Import von Kollektionen, dem Server-Update oder der
  Wiederherstellung eines anderen Backups.
- **Audit**: wer was wann getan hat (Start/Stopp, Konfigurationsänderungen,
  Mods, Backups, Factory-Reset).
- **Metriken**: Live-CPU/RAM (aus cgroup v2 gelesen, genau wie bei einem
  echten Hosting-Panel; mit `os`-basiertem Fallback für die lokale
  Entwicklung), clientseitiges Verlaufsdiagramm (letzte 30 Messwerte, Abfrage
  alle 2s), Legende, Fadenkreuz + Tooltip und Tabellenansicht.
- **Logs**: Live-Streaming per SSE.
- **Aktivitätskonsole**: unteres Schubfach, von jeder Seite aus sichtbar,
  zeigt jeden API-Aufruf des Frontends (Methode, Route, Status, Dauer)
  verschachtelt mit dem Live-Log-Stream des Backends — um die Frage "ist
  beim Klick auf diesen Button etwas passiert?" zu beantworten, ohne zum
  Logs-Tab wechseln zu müssen.

## Architektur

| Schicht | Technologie |
|---|---|
| Frontend | React 19 + Vite, statische Ausgabe |
| Web-Proxy | Nginx Alpine |
| Backend | Node.js 24 + Fastify + TypeScript |
| Zustand | SQLite (better-sqlite3) |
| Konfiguration | TOML |
| Container | Podman |
| Deployment | Node/TypeScript, SSH und Remote-Podman |

```text
backend/src/
├── config/     Lesen und Validieren von TOML
├── domain/     ServerPaths, StartupSettings, Workshop-Mods, SandboxVars.lua,
│               generische server.ini + Synchronisierung verwalteter
│               Schlüssel, Steam-Kollektionen, Spielerliste
├── infra/      SQLite, LogHub (Puffer + SSE), Factory-Reset, Backups
│               (tar.gz), Audit-Protokoll, Metrik-Sampler (cgroup v2)
├── process/    RuntimeState (Serverprozess), SteamCmdRunner, RCON-Client
├── routes/     Fastify-Endpunkte (auth, server, mods, files, sandbox,
│               server-settings, backups, audit, metrics, system)
├── security/   Passwort-Hashing, signierte Sitzung (HMAC)
└── app.ts / server.ts

frontend/src/
├── api/                Fetch-Client + Auth-Guard + API-Aktivitäts-Pub-Sub
├── ActivityConsole.tsx globales Konsolen-Schubfach (API-Aufrufe + Backend-Logs)
└── sections/           Dashboard, Metrics (+ MetricsChart), Players, Console, Mods,
                        Server Settings, Sandbox, Config, Logs, Backups, Audit,
                        Settings, System

deploy/         Remote-Deployment-Skript (TS-Äquivalent von deploy.py)
```

## Konfiguration

### Schnellinstallation

Voraussetzungen:

- Node.js 24 oder neuer (`node --version`).
- Podman und `podman compose`, um die vollständige Installation
  auszuführen.

Aus dem Projektstammverzeichnis:

```bash
npm install
npm run setup
```

`npm run setup` erstellt `config/manager.secrets.toml` mit zufälligen
Secrets, privaten Berechtigungen und einem Initialpasswort für den Benutzer
`admin`. Das im Terminal angezeigte Passwort speichern; der Installer
überschreibt keine bestehende Secrets-Datei.

Anschließend die Container starten:

```bash
podman compose -f podman-compose.yml up -d --build
```

`http://127.0.0.1:8080` öffnen. Die mitgelieferte Konfiguration führt echte
Installationen durch. Für die Entwicklung ohne Server-Download
`mock_steamcmd` und `mock_server_binary` in `config/manager.toml` auf
`true` setzen; die Oberfläche kennzeichnet diese Aktionen dann deutlich als
simuliert.

Falls unter Windows PowerShell die Ausführungsrichtlinie `npm.ps1`
blockiert, `npm.cmd` für dieselben Befehle verwenden:

```powershell
npm.cmd install
npm.cmd run setup
podman compose -f podman-compose.yml up -d --build
```

### Manuelle Konfiguration

1. `config/manager.toml` für Ports, Netzwerk, Pfade und Limits bearbeiten.
2. Falls `npm run setup` nicht verwendet wurde, die private Datei
   erstellen:

```bash
cp config/manager.secrets.example.toml config/manager.secrets.toml
chmod 600 config/manager.secrets.toml
```

3. Das Panel-Passwort und das Session-Secret ersetzen.

Ein Session-Secret erzeugen mit:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`manager.secrets.toml` ist von Git ausgeschlossen und wird nie in ein Image
kopiert. Beim Deployment wird sie per SCP übertragen und schreibgeschützt
eingehängt.

SQLite wird unter `<zomboid_data_dir>/manager.sqlite3` gespeichert und
enthält Panel-Zugangsdaten sowie die aktive Modliste. Große Dateien
(Server-Installation, `~/Zomboid`, SteamCMD) bleiben weiterhin in
dedizierten Volumes.

### Hauptabschnitte

- `[web]`: interner Port, öffentlicher Port, Bind, Panel-Benutzer.
- `[server]`: Installations-/Daten-/SteamCMD-Verzeichnisse, Servername,
  optionale `public_address` (öffentliche IP oder DNS zum Beitreten
  angezeigt), Spiel- und RCON-Ports, Speicherlimit.

Der eingebaute Admin-Benutzer des Spiels heißt `admin`. Sein Passwort wird
als `server.admin_password` in `config/manager.secrets.toml` festgelegt und
mit `-adminpassword` übergeben, damit der erste Start nicht von einer
interaktiven Konsole abhängt.

Der Prozess startet mit `-cachedir=<zomboid_data_dir>`, damit Welten,
Benutzer, Logs und `Server/*.ini`/`SandboxVars.lua`-Dateien im persistenten,
vom Panel verwalteten Volume liegen, statt im flüchtigen Home-Verzeichnis
des Containers.
- `[steam]`: optionale Liste autorisierter Steam-IDs (Panel-Login).
- `[runtime]`: Zeitzone und `mock_*`-Flags für die Entwicklung ohne
  SteamCMD oder echtes Server-Binary.
- `[backups]`: Backup-Verzeichnis, wie viele geplante Backups aufbewahrt
  werden, und das Intervall des geplanten Backups in Stunden (`0`
  deaktiviert es; manuelle Backups funktionieren immer).

Für den Host-Netzwerkmodus `config/manager.host.toml` zusammen mit dem
Overlay `podman-compose.host.yml` verwenden.

## Entwicklung

Voraussetzungen: Node.js 24. Podman wird nur benötigt, um Container zu
testen.

```bash
npm install
npm run setup           # nur beim ersten Mal
npm run dev:backend    # Fastify mit Reload (tsx watch)
npm run dev:frontend   # Vite-Dev-Server, leitet /api an das Backend weiter
```

Backend und Frontend in zwei Terminals ausführen. `http://127.0.0.1:5173`
öffnen; Vite leitet `/api` an `http://127.0.0.1:8080` weiter.

Build und Tests:

```bash
npm run build:backend
npm run build:frontend
npm test               # Backend + Frontend + Deploy
```

## Lokales Podman

```bash
podman compose -f podman-compose.yml up -d --build
podman compose -f podman-compose.yml ps
podman compose -f podman-compose.yml logs --tail 200
```

Host-Modus:

```bash
podman compose -f podman-compose.yml -f podman-compose.host.yml up -d --build
```

Persistente Volumes: `pz-install`, `pz-data`, `pz-steamcmd`, `pz-backups`.
Das Entfernen oder Neuerstellen von Containern löscht diese Volumes nicht.

### Überprüfen der Serverinstallation

Das Dashboard betrachtet eine Installation nicht schon deshalb als
abgeschlossen, weil SteamCMD den Exit-Code `0` zurückgibt. Es prüft sowohl
`start-server.sh` als auch `steamapps/appmanifest_380870.acf` im
Installations-Volume und zeigt die Steam-`buildid`. Erscheint **No real
build installed (simulation)**, ist `mock_steamcmd` noch aktiv und es
wurden keine Dateien heruntergeladen.

Der dedizierte Project-Zomboid-Server (Steam-App-ID `380870`) wird mit
`+login anonymous` installiert; ein Konto, das das Spiel besitzt, ist nicht
erforderlich. Das unterscheidet sich vom Ablauf des Arma-3-Panels, das eine
interaktive SteamCMD-Sitzung mit Steam Guard aufrechterhält. Die
`[steam]`-Zugangsdaten sind für Ausnahmefälle reserviert und für die
Installation des Basis-Servers nicht erforderlich.

### Vollständiger Reset über die API

Der authentifizierte Endpunkt `POST /api/system/factory-reset` löscht
sämtliche persistenten Inhalte: Server-Installation, `~/Zomboid`,
heruntergeladene Workshop-Mods, SQLite, SteamCMD-Zustand und alle Backups.
Dafür muss der Spielserver gestoppt sein.

```json
{
  "currentPassword": "aktuelles-panel-passwort",
  "confirmation": "RESET ALL ZOMBOID DATA"
}
```

Die Anfrage schreibt einen atomaren Marker und startet den Prozess neu. Das
Backend leert die persistenten Volumes beim Start, bevor SQLite geöffnet
wird, und entfernt den Marker erst, wenn alle Vorgänge erfolgreich
abgeschlossen sind. Wird der Prozess unterbrochen, versucht es der nächste
Start erneut.

## Remote-Deployment

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

Selektive Deployments:

```bash
npx tsx deploy/deploy.ts dev --check
npx tsx deploy/deploy.ts dev --frontend
npx tsx deploy/deploy.ts dev --backend
npx tsx deploy/deploy.ts prod --frontend --backend --yes
```

Remote-Betrieb:

```bash
npx tsx deploy/deploy.ts prod --status
npx tsx deploy/deploy.ts prod --logs api
npx tsx deploy/deploy.ts prod --logs frontend
```

Das Skript:

1. validiert TOML, SSH, tar, scp und Podman-Konnektivität;
2. überträgt ein Release ohne Secrets oder Build-Artefakte (tar über SSH);
3. überträgt `manager.secrets.toml` separat mit `chmod 600`;
4. baut nur das angeforderte Image auf dem Remote-Server;
5. erhält die Volumes;
6. ersetzt nur den ausgewählten Container mit `podman run --replace`;
7. wartet auf den Health-Check und führt bei Fehlschlag automatisch ein
   Rollback auf das vorherige Image durch;
8. startet das Frontend nach einem reinen Backend-Deploy neu;
9. entfernt alte, containerlose Images nur, wenn sie das Label
   `project=pz-manager` tragen.

Ein Backend-Update stoppt den Project-Zomboid-Prozess, da dieser im selben
Container läuft. Deshalb ist eine Bestätigung (`DEPLOY`) oder `--yes`
erforderlich.

## API und Sicherheit

- `/api/health` ist öffentlich für Health-Checks.
- `/api/auth/*` verwaltet Sitzungen (HMAC-SHA256-signiertes Cookie, keine
  serverseitige Session-Speicherung).
- Der Rest von `/api/*` erfordert Authentifizierung.
- Der Datei-Editor beschränkt Pfade auf das Zomboid-Datenverzeichnis.
- Passwörter werden mit `scrypt` abgeleitet.
- SteamCMD-Zugangsdaten werden in Befehlsprotokollen geschwärzt.
- `POST /api/workshop/install-collection` löst eine Steam-Workshop-
  Kollektion über `ISteamRemoteStorage/GetCollectionDetails` auf (ohne
  API-Key) und lädt jedes Element mit SteamCMD herunter.
- Jede administrative Aktion (Start/Stopp, Mods, Sandbox, Backups,
  Factory-Reset) wird unter `GET /api/audit` protokolliert.

## Prüfung vor Produktion

```bash
npm run build:backend
npm run build:frontend
npm test
podman build -f Containerfile.api -t pz-manager-api:test .
podman build -f Containerfile.frontend -t pz-manager-frontend:test .
```
