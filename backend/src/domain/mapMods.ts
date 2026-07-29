import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SqliteStore } from "../infra/sqliteStore.js";
import type { ServerPaths } from "./serverPaths.js";
import { parseModInfo } from "./modResolver.js";
import { upsertIniFields } from "./serverIni.js";

export type MapCompatibility = "build41" | "build42" | "universal";

export interface DetectedMapComponent {
  key: string;
  workshopId: string;
  modId: string;
  modName: string;
  mapFolder: string;
  compatibility: MapCompatibility;
  hasSpawnPoints: boolean;
  cells: string[];
}

export interface MapConfigEntry {
  key: string;
  enabled: boolean;
  spawnEnabled: boolean;
}

export interface MapConfig {
  entries: MapConfigEntry[];
}

const ACTIVE_KEY = "map-mod-config";
const PENDING_KEY = "pending-map-mod-config";

async function walkFiles(root: string, maxDepth = 9): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target, depth + 1);
      else if (entry.isFile()) files.push(target);
    }
  }
  await walk(root, 0);
  return files;
}

function compatibilityFor(filePath: string): MapCompatibility {
  const version = filePath.split(path.sep).find((segment) => /^\d+(?:\.\d+)?$/.test(segment));
  if (!version) return "build41";
  return Number(version.split(".")[0]) >= 42 ? "build42" : "build41";
}

export async function discoverMapComponents(paths: ServerPaths): Promise<DetectedMapComponent[]> {
  let workshopIds: string[] = [];
  try {
    workshopIds = await readdir(paths.workshopContentDir);
  } catch {
    return [];
  }
  const result: DetectedMapComponent[] = [];

  for (const workshopId of workshopIds) {
    const itemRoot = path.join(paths.workshopContentDir, workshopId);
    const files = await walkFiles(itemRoot);
    const modInfoFiles = files.filter((file) => path.basename(file).toLowerCase() === "mod.info");
    const mapInfoFiles = files.filter((file) => path.basename(file).toLowerCase() === "map.info");

    for (const mapInfo of mapInfoFiles) {
      const mapFolder = path.basename(path.dirname(mapInfo));
      const owningInfo = modInfoFiles
        .filter((candidate) => mapInfo.startsWith(path.dirname(candidate) + path.sep))
        .sort((a, b) => b.length - a.length)[0];
      if (!owningInfo) continue;
      const mod = parseModInfo(await readFile(owningInfo, "utf-8"), path.dirname(owningInfo));
      if (!mod) continue;
      const mapDir = path.dirname(mapInfo);
      const relativePrefix = path.relative(itemRoot, mapDir).replaceAll(path.sep, "/");
      const lotHeaderPrefix = `${mapDir}${path.sep}`;
      const cells = files
        .filter((file) => file.startsWith(lotHeaderPrefix) && file.endsWith(".lotheader"))
        .map((file) => path.basename(file, ".lotheader"))
        .filter((name) => /^-?\d+_-?\d+$/.test(name))
        .sort();
      result.push({
        key: `${workshopId}:${mod.id}:${relativePrefix}`,
        workshopId,
        modId: mod.id,
        modName: mod.name,
        mapFolder,
        compatibility: compatibilityFor(owningInfo),
        hasSpawnPoints: files.some(
          (file) => file.startsWith(lotHeaderPrefix) && path.basename(file) === "spawnpoints.lua",
        ),
        cells,
      });
    }
  }
  return result.sort((a, b) => a.modName.localeCompare(b.modName) || a.mapFolder.localeCompare(b.mapFolder));
}

export function mergeMapConfig(
  detected: DetectedMapComponent[],
  stored?: MapConfig,
): MapConfig {
  const byKey = new Map(stored?.entries.map((entry) => [entry.key, entry]));
  return {
    entries: detected.map((component) => ({
      key: component.key,
      enabled: byKey.get(component.key)?.enabled ?? true,
      spawnEnabled: component.hasSpawnPoints && (byKey.get(component.key)?.spawnEnabled ?? true),
    })),
  };
}

export function mapConflicts(
  detected: DetectedMapComponent[],
  config: MapConfig,
): { cell: string; maps: string[] }[] {
  const enabled = new Set(config.entries.filter((entry) => entry.enabled).map((entry) => entry.key));
  const owners = new Map<string, string[]>();
  for (const component of detected.filter((entry) => enabled.has(entry.key))) {
    for (const cell of component.cells) {
      owners.set(cell, [...(owners.get(cell) ?? []), component.mapFolder]);
    }
  }
  return [...owners.entries()]
    .filter(([, maps]) => maps.length > 1)
    .map(([cell, maps]) => ({ cell, maps }));
}

export function loadMapConfig(store: SqliteStore, detected: DetectedMapComponent[]): MapConfig {
  return mergeMapConfig(detected, store.getJson<MapConfig>(ACTIVE_KEY));
}

export function loadPendingMapConfig(store: SqliteStore): MapConfig | undefined {
  return store.getJson<MapConfig>(PENDING_KEY);
}

export function savePendingMapConfig(store: SqliteStore, config: MapConfig): void {
  store.setJson(PENDING_KEY, config);
}

export async function applyMapConfig(
  store: SqliteStore,
  paths: ServerPaths,
  detected: DetectedMapComponent[],
  config: MapConfig,
): Promise<void> {
  const componentByKey = new Map(detected.map((component) => [component.key, component]));
  const enabled = config.entries
    .filter((entry) => entry.enabled)
    .map((entry) => componentByKey.get(entry.key))
    .filter((entry): entry is DetectedMapComponent => Boolean(entry));
  let ini = "";
  try {
    ini = await readFile(paths.serverIniPath, "utf-8");
  } catch {}
  const mapFolders = [...enabled.map((entry) => entry.mapFolder), "Muldraugh, KY"];
  await mkdir(path.dirname(paths.serverIniPath), { recursive: true });
  await writeFile(
    paths.serverIniPath,
    upsertIniFields(ini, [{ key: "Map", value: [...new Set(mapFolders)].join(";") }], {
      strict: false,
    }),
    "utf-8",
  );

  const spawnEnabled = new Set(
    config.entries.filter((entry) => entry.enabled && entry.spawnEnabled).map((entry) => entry.key),
  );
  const customRegions = enabled
    .filter((entry) => entry.hasSpawnPoints && spawnEnabled.has(entry.key))
    .map(
      (entry) =>
        `        { name = ${JSON.stringify(entry.modName)}, file = ${JSON.stringify(`media/maps/${entry.mapFolder}/spawnpoints.lua`)} },`,
    );
  const vanillaRegions = [
    ["Echo Creek, KY", "Echo Creek, KY"],
    ["Muldraugh, KY", "Muldraugh, KY"],
    ["West Point, KY", "West Point, KY"],
    ["Rosewood, KY", "Rosewood, KY"],
    ["Riverside, KY", "Riverside, KY"],
  ].map(([name, folder]) => `        { name = ${JSON.stringify(name)}, file = ${JSON.stringify(`media/maps/${folder}/spawnpoints.lua`)} },`);
  const lua = `function SpawnRegions()\n    return {\n${[...customRegions, ...vanillaRegions].join("\n")}\n    }\nend\n`;
  await writeFile(paths.spawnRegionsPath, lua, "utf-8");
  store.setJson(ACTIVE_KEY, config);
  store.deleteKey(PENDING_KEY);
}

export async function activatePendingMapConfig(
  store: SqliteStore,
  paths: ServerPaths,
): Promise<boolean> {
  const pending = loadPendingMapConfig(store);
  if (!pending) return false;
  const detected = await discoverMapComponents(paths);
  await applyMapConfig(store, paths, detected, mergeMapConfig(detected, pending));
  return true;
}
