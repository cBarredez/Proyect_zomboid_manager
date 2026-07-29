import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/index.js";
import type { ServerPaths } from "./serverPaths.js";
import { buildModLines, type StartupSettings } from "./startupSettings.js";
import { upsertIniFields } from "./serverIni.js";

/**
 * Keys the panel writes automatically and that the generic Server Settings
 * editor must not let a user hand-edit out of sync with it.
 */
export const MANAGED_INI_KEYS = new Set(["Mods", "WorkshopItems", "Map", "RCONPort", "RCONPassword", "MaxPlayers"]);

/**
 * Writes Mods=/WorkshopItems=/RCONPort=/RCONPassword=/MaxPlayers= into the
 * real server ini from our own managed state. Without this, mods installed
 * through the panel and the RCON password from secrets never actually reach
 * the game server — call this before every start and after any mod change.
 */
export async function syncManagedIniFields(
  paths: ServerPaths,
  config: AppConfig,
  settings: StartupSettings,
): Promise<void> {
  const { mods, workshopItems } = buildModLines(settings);

  let source = "";
  try {
    source = await readFile(paths.serverIniPath, "utf-8");
  } catch {
    // ini doesn't exist yet (fresh install); upsert below creates it.
  }

  const updated = upsertIniFields(
    source,
    [
      { key: "Mods", value: mods },
      { key: "WorkshopItems", value: workshopItems },
      { key: "RCONPort", value: config.server.rconPort },
      { key: "RCONPassword", value: config.server.rconPassword },
      { key: "MaxPlayers", value: settings.maxPlayers },
    ],
    { strict: false },
  );

  await mkdir(path.dirname(paths.serverIniPath), { recursive: true });
  await writeFile(paths.serverIniPath, updated, "utf-8");
}
