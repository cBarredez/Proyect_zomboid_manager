import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface ModInfo {
  id: string;
  name: string;
  folderPath: string;
  /** Mod IDs (not Workshop IDs) this mod's `Require=` field declares as dependencies. */
  requires: string[];
}

/**
 * Parses a PZ `mod.info` file. It's an ad-hoc `key=value` format (not INI
 * sections) — the manager reads `id`/`name` plus `Require=`, a comma or
 * semicolon separated list of other mod IDs this mod depends on. Note
 * `Require=` lists mod IDs, not Workshop item IDs, so satisfying it means
 * finding *some* installed Workshop item that provides that mod ID.
 */
export function parseModInfo(content: string, folderPath: string): ModInfo | null {
  const lines = content.split(/\r?\n/);
  let id: string | undefined;
  let name: string | undefined;
  let requires: string[] = [];

  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (key === "id") id = value;
    if (key === "name") name = value;
    if (key === "require") {
      requires = value
        .split(/[,;]/)
        .map((v) => v.trim())
        .filter(Boolean);
    }
  }

  if (!id) return null;
  return { id, name: name ?? id, folderPath, requires };
}

/**
 * A single Workshop item can bundle multiple mods, each in its own
 * subfolder with its own `mod.info` (commonly under `<item>/mods/<modId>/`,
 * sometimes directly at `<item>/mod.info`). This walks both shapes and
 * returns every mod found, which is the PZ-specific indirection between
 * "Workshop item ID" and the `Mods=` ini values.
 */
export async function resolveModsInWorkshopItem(itemDir: string): Promise<ModInfo[]> {
  const found: ModInfo[] = [];
  const infoPaths = await findModInfoFiles(itemDir, 5);
  for (const infoPath of infoPaths) {
    const mod = parseModInfo(await readFile(infoPath, "utf-8"), path.dirname(infoPath));
    if (mod && !found.some((entry) => entry.id === mod.id)) found.push(mod);
  }

  return found;
}

/** Supports Build 41 and Build 42 versioned layouts such as mods/name/42/mod.info. */
async function findModInfoFiles(root: string, maxDepth: number): Promise<string[]> {
  const matches: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || !(await dirExists(dir))) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === "mod.info") matches.push(entryPath);
      else if (entry.isDirectory()) await walk(entryPath, depth + 1);
    }
  }
  await walk(root, 0);
  return matches;
}

/** Returns mod IDs that appear in some mod's `Require=` list but aren't present in `allMods`. */
export function findMissingDependencies(allMods: ModInfo[]): string[] {
  const installedIds = new Set(allMods.map((m) => m.id));
  const missing = new Set<string>();

  for (const mod of allMods) {
    for (const requiredId of mod.requires) {
      if (!installedIds.has(requiredId)) missing.add(requiredId);
    }
  }

  return [...missing];
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}
