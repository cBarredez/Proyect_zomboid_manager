# Project Zomboid Server Manager

**Languages:** [Español](README.md) · [English](README.en.md) · [Deutsch](README.de.md)

Web panel to install, update, and operate a dedicated Project Zomboid
server: Steam Workshop mods (including full collections), sandbox settings,
RCON console, connected players, world backups, and an audit log of
administrative actions.

## Features

- **Server**: install/update via SteamCMD (with **branch/build** selection:
  stable, `unstable`, `iwillbackupmysave`, or any other via `-beta`),
  start/stop/restart, live status.
- **Players**: list of connected players via RCON, kick/ban/unban.
- **RCON console**: terminal with history (↑/↓) for any command.
- **Mods**: install by Workshop ID or import a **full collection**
  (automatically resolves each item via the Steam Web API) and detects
  missing dependencies (`Require=`). `Mods=`/`WorkshopItems=`/`RCONPort=`/
  `RCONPassword=`/`MaxPlayers=` are automatically written to the real
  `.ini` before every startup and after any mod change — they never sit
  only in the panel's database.
- **Server Settings**: generic editor for the rest of the real `.ini` (map,
  join password, visibility, PVP, max players, whatever exists in the
  file) with typed controls, excluding the keys managed automatically
  above.
- **Sandbox**: categorized editor for `SandboxVars.lua` (checkboxes/
  numbers/text depending on each setting's real type) instead of hand-
  editing Lua.
- **Config**: raw file editor (ini/lua) scoped to the data directory, for
  anything the structured editors don't cover.
- **Backups**: manual and scheduled world snapshots (`tar.gz`), list/
  restore/delete, with an automatic snapshot before installing mods,
  importing collections, updating the server, or restoring another
  backup.
- **Audit**: who did what and when (start/stop, config changes, mods,
  backups, factory reset).
- **Metrics**: live CPU/RAM (read from cgroup v2, just like a real hosting
  panel; with an `os`-based fallback for local development), client-side
  history chart (last 30 samples, polled every 2s), legend, crosshair +
  tooltip, and table view.
- **Logs**: live streaming via SSE.
- **Activity console**: bottom drawer, visible from any page, showing
  every frontend API call (method, route, status, duration) interleaved
  with the backend's live log stream — to answer "did anything happen
  when I clicked that button?" without having to go to the Logs tab.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite, static output |
| Web proxy | Nginx Alpine |
| Backend | Node.js 24 + Fastify + TypeScript |
| State | SQLite (better-sqlite3) |
| Configuration | TOML |
| Containers | Podman |
| Deployment | Node/TypeScript, SSH, and remote Podman |

```text
backend/src/
├── config/     TOML reading and validation
├── domain/     ServerPaths, StartupSettings, Workshop mods, SandboxVars.lua,
│               generic server.ini + managed-key sync, Steam collections,
│               player list
├── infra/      SQLite, LogHub (buffer + SSE), factory reset, backups (tar.gz),
│               audit log, metrics sampler (cgroup v2)
├── process/    RuntimeState (server process), SteamCmdRunner, RCON client
├── routes/     Fastify endpoints (auth, server, mods, files, sandbox,
│               server-settings, backups, audit, metrics, system)
├── security/   password hashing, signed session (HMAC)
└── app.ts / server.ts

frontend/src/
├── api/                fetch client + auth guard + API-activity pub-sub
├── ActivityConsole.tsx global console drawer (API calls + backend logs)
└── sections/           Dashboard, Metrics (+ MetricsChart), Players, Console, Mods,
                        Server Settings, Sandbox, Config, Logs, Backups, Audit,
                        Settings, System

deploy/         remote deployment script (TS equivalent of deploy.py)
```

## Configuration

### Quick install

Requirements:

- Node.js 24 or newer (`node --version`).
- Podman and `podman compose` to run the full install.

From the project root:

```bash
npm install
npm run setup
```

`npm run setup` creates `config/manager.secrets.toml` with random secrets,
private permissions, and an initial password for the `admin` user. Save the
password shown in the terminal; the installer will not overwrite an
existing secrets file.

Then start the containers:

```bash
podman compose -f podman-compose.yml up -d --build
```

Open `http://127.0.0.1:8080`. The included configuration performs real
installs. For development without downloading the server, set
`mock_steamcmd` and `mock_server_binary` to `true` in
`config/manager.toml`; the UI will clearly flag those actions as
simulated.

On Windows PowerShell, if the execution policy blocks `npm.ps1`, use
`npm.cmd` for the same commands:

```powershell
npm.cmd install
npm.cmd run setup
podman compose -f podman-compose.yml up -d --build
```

### Manual configuration

1. Edit `config/manager.toml` for ports, network, paths, and limits.
2. If you didn't use `npm run setup`, create the private file:

```bash
cp config/manager.secrets.example.toml config/manager.secrets.toml
chmod 600 config/manager.secrets.toml
```

3. Replace the panel password and the session secret.

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`manager.secrets.toml` is gitignored and never copied inside an image.
During deployment it's transferred via SCP and mounted read-only.

SQLite is kept at `<zomboid_data_dir>/manager.sqlite3` and stores panel
credentials and the active mod list. Large files (server install,
`~/Zomboid`, SteamCMD) continue to live in dedicated volumes.

### Main sections

- `[web]`: internal port, public port, bind, panel user.
- `[server]`: install/data/SteamCMD directories, server name, optional
  `public_address` (public IP or DNS shown to join), game and RCON ports,
  memory limit.

The game's built-in admin user is called `admin`. Its password is set as
`server.admin_password` in `config/manager.secrets.toml` and passed with
`-adminpassword` so the first startup doesn't depend on an interactive
console.

The process starts with `-cachedir=<zomboid_data_dir>` so worlds, users,
logs, and `Server/*.ini`/`SandboxVars.lua` files live in the persistent
volume the panel manages, instead of the container's ephemeral home
directory.
- `[steam]`: optional list of authorized Steam IDs (panel login).
- `[runtime]`: timezone and `mock_*` flags for development without SteamCMD
  or a real server binary.
- `[backups]`: backup directory, how many scheduled backups to keep, and
  the scheduled-backup interval in hours (`0` disables it; manual backups
  always work).

For host networking, use `config/manager.host.toml` with the
`podman-compose.host.yml` overlay.

## Development

Requirements: Node.js 24. Podman is only needed to test containers.

```bash
npm install
npm run setup           # first time only
npm run dev:backend    # Fastify with reload (tsx watch)
npm run dev:frontend   # Vite dev server, proxies /api to the backend
```

Run backend and frontend in two terminals. Open `http://127.0.0.1:5173`;
Vite proxies `/api` to `http://127.0.0.1:8080`.

Build and tests:

```bash
npm run build:backend
npm run build:frontend
npm test               # backend + frontend + deploy
```

## Local Podman

```bash
podman compose -f podman-compose.yml up -d --build
podman compose -f podman-compose.yml ps
podman compose -f podman-compose.yml logs --tail 200
```

Host mode:

```bash
podman compose -f podman-compose.yml -f podman-compose.host.yml up -d --build
```

Persistent volumes: `pz-install`, `pz-data`, `pz-steamcmd`, `pz-backups`.
Removing or recreating containers does not delete these volumes.

### Verifying the server installation

The Dashboard doesn't consider an install finished just because SteamCMD
returns exit code `0`. It checks both `start-server.sh` and
`steamapps/appmanifest_380870.acf` inside the install volume and shows the
Steam `buildid`. If **No real build installed (simulation)** appears,
`mock_steamcmd` is still on and no files were downloaded.

The Project Zomboid dedicated server (Steam App ID `380870`) installs with
`+login anonymous`; it doesn't require an account that owns the game. This
differs from the Arma 3 panel's flow, which keeps an interactive SteamCMD
session with Steam Guard. `[steam]` credentials are reserved for
exceptional cases and aren't needed to install the base server.

### Full reset from the API

The authenticated endpoint `POST /api/system/factory-reset` deletes all
persistent content: server install, `~/Zomboid`, downloaded Workshop mods,
SQLite, SteamCMD state, and all backups. It requires the game server to be
stopped.

```json
{
  "currentPassword": "current-panel-password",
  "confirmation": "RESET ALL ZOMBOID DATA"
}
```

The request writes an atomic marker and restarts the process. The backend
empties the persistent volumes on startup, before opening SQLite, and only
removes the marker once every operation completes successfully. If the
process is interrupted, the next startup retries it.

## Remote deployment

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

Selective deployments:

```bash
npx tsx deploy/deploy.ts dev --check
npx tsx deploy/deploy.ts dev --frontend
npx tsx deploy/deploy.ts dev --backend
npx tsx deploy/deploy.ts prod --frontend --backend --yes
```

Remote operation:

```bash
npx tsx deploy/deploy.ts prod --status
npx tsx deploy/deploy.ts prod --logs api
npx tsx deploy/deploy.ts prod --logs frontend
```

The script:

1. validates TOML, SSH, tar, scp, and Podman connectivity;
2. transfers a release without secrets or build artifacts (tar over SSH);
3. transfers `manager.secrets.toml` separately with `chmod 600`;
4. builds only the requested image on the remote server;
5. preserves volumes;
6. replaces only the selected container with `podman run --replace`;
7. waits for the health check and automatically rolls back to the previous
   image if it fails;
8. restarts the frontend after a backend-only deploy;
9. removes old, container-less images only if they carry the
   `project=pz-manager` label.

Updating the backend stops the Project Zomboid process because it lives in
the same container. That's why it requires confirmation (`DEPLOY`) or
`--yes`.

## API and security

- `/api/health` is public for health checks.
- `/api/auth/*` manages sessions (HMAC-SHA256-signed cookie, no
  server-side session storage).
- The rest of `/api/*` requires authentication.
- The file editor restricts paths to the Zomboid data directory.
- Passwords are derived with `scrypt`.
- SteamCMD credentials are redacted in command logs.
- `POST /api/workshop/install-collection` resolves a Steam Workshop
  collection via `ISteamRemoteStorage/GetCollectionDetails` (no API key)
  and downloads each item with SteamCMD.
- Every administrative action (start/stop, mods, sandbox, backups,
  factory reset) is recorded in `GET /api/audit`.

## Pre-production verification

```bash
npm run build:backend
npm run build:frontend
npm test
podman build -f Containerfile.api -t pz-manager-api:test .
podman build -f Containerfile.frontend -t pz-manager-frontend:test .
```
