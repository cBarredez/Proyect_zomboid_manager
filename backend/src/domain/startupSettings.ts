import type { SqliteStore } from "../infra/sqliteStore.js";

export interface StartupSettings {
  serverName: string;
  maxPlayers: number;
  memoryMinMb: number;
  memoryMaxMb: number;
  mods: string[];
  workshopItems: string[];
  extraJvmArgs: string[];
  /** SteamCMD `-beta <branch>` to install/update, e.g. "unstable". Empty = default stable branch. */
  betaBranch: string;
}

const DEFAULTS: Omit<StartupSettings, "serverName"> = {
  maxPlayers: 16,
  memoryMinMb: 2048,
  memoryMaxMb: 4096,
  mods: [],
  workshopItems: [],
  extraJvmArgs: [],
  betaBranch: "",
};

const STARTUP_SETTINGS_KEY = "startup-settings";

export function normalizeStartupSettings(
  serverName: string,
  overrides: Partial<StartupSettings> = {},
): StartupSettings {
  const merged: StartupSettings = { serverName, ...DEFAULTS, ...overrides };

  merged.maxPlayers = clamp(merged.maxPlayers, 1, 100);
  merged.memoryMinMb = Math.max(512, merged.memoryMinMb);
  merged.memoryMaxMb = Math.max(merged.memoryMinMb, merged.memoryMaxMb);
  merged.mods = dedupeNonEmpty(merged.mods);
  merged.workshopItems = dedupeNonEmpty(merged.workshopItems);
  merged.extraJvmArgs = dedupeNonEmpty(merged.extraJvmArgs);
  merged.betaBranch = merged.betaBranch.trim();

  return merged;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupeNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

/** Builds the `Mods=` and `WorkshopItems=` lines written into the server ini. */
export function buildModLines(settings: StartupSettings): { mods: string; workshopItems: string } {
  return {
    mods: settings.mods.join(";"),
    workshopItems: settings.workshopItems.join(";"),
  };
}

export function loadStartupSettings(store: SqliteStore, serverName: string): StartupSettings {
  const stored = store.getJson<StartupSettings>(STARTUP_SETTINGS_KEY);
  return normalizeStartupSettings(serverName, stored ?? {});
}

export function saveStartupSettings(store: SqliteStore, settings: StartupSettings): void {
  store.setJson(STARTUP_SETTINGS_KEY, settings);
}
