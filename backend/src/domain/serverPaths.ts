import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/index.js";

export const PZ_DEDICATED_SERVER_APP_ID = "380870";
export const PZ_WORKSHOP_APP_ID = "108600";

export interface ServerPaths {
  installDir: string;
  dataDir: string;
  steamcmdDir: string;
  steamcmdBinary: string;
  serverConfigDir: string;
  serverIniPath: string;
  sandboxVarsPath: string;
  spawnRegionsPath: string;
  spawnPointsPath: string;
  workshopContentDir: string;
  modsCacheDir: string;
}

function steamcmdBinaryName(): string {
  return process.platform === "win32" ? "steamcmd.exe" : "steamcmd.sh";
}

export function resolveServerPaths(config: AppConfig): ServerPaths {
  const { server } = config;
  const serverConfigDir = path.join(server.zomboidDataDir, "Server");
  const workshopContentDir = path.join(
    server.steamcmdDir,
    "Steam",
    "steamapps",
    "workshop",
    "content",
    PZ_WORKSHOP_APP_ID,
  );

  return {
    installDir: server.zomboidInstallDir,
    dataDir: server.zomboidDataDir,
    steamcmdDir: server.steamcmdDir,
    steamcmdBinary: path.join(server.steamcmdDir, steamcmdBinaryName()),
    serverConfigDir,
    serverIniPath: path.join(serverConfigDir, `${server.serverName}.ini`),
    sandboxVarsPath: path.join(serverConfigDir, `${server.serverName}_SandboxVars.lua`),
    spawnRegionsPath: path.join(serverConfigDir, `${server.serverName}_spawnregions.lua`),
    spawnPointsPath: path.join(serverConfigDir, `${server.serverName}_spawnpoints.lua`),
    workshopContentDir,
    modsCacheDir: path.join(server.zomboidDataDir, "mods"),
  };
}

/**
 * Ensures every directory the manager depends on exists, creating it if
 * necessary. Mirrors arma_server's ServerPaths.DetectAsync (auto-create on
 * first run rather than requiring manual setup).
 */
export async function detectServerPaths(config: AppConfig): Promise<ServerPaths> {
  const paths = resolveServerPaths(config);

  await Promise.all([
    mkdir(paths.installDir, { recursive: true }),
    mkdir(paths.dataDir, { recursive: true }),
    mkdir(paths.steamcmdDir, { recursive: true }),
    mkdir(paths.serverConfigDir, { recursive: true }),
    mkdir(paths.workshopContentDir, { recursive: true }),
    mkdir(paths.modsCacheDir, { recursive: true }),
  ]);

  return paths;
}
