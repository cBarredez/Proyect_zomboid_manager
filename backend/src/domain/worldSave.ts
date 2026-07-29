import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { ServerPaths } from "./serverPaths.js";

export function resolveWorldSavePaths(paths: ServerPaths, serverName: string) {
  if (!serverName || path.basename(serverName) !== serverName) throw new Error("invalid server name");
  return {
    worldDir: path.join(paths.dataDir, "Saves", "Multiplayer", serverName),
    playerDatabase: path.join(paths.dataDir, "db", `${serverName}.db`),
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function worldSaveExists(paths: ServerPaths, serverName: string): Promise<boolean> {
  const targets = resolveWorldSavePaths(paths, serverName);
  return (await exists(targets.worldDir)) || (await exists(targets.playerDatabase));
}

export async function eraseWorldSave(paths: ServerPaths, serverName: string): Promise<void> {
  const targets = resolveWorldSavePaths(paths, serverName);
  await Promise.all([
    rm(targets.worldDir, { recursive: true, force: true }),
    rm(targets.playerDatabase, { force: true }),
  ]);
  await mkdir(path.dirname(targets.worldDir), { recursive: true });
  await mkdir(path.dirname(targets.playerDatabase), { recursive: true });
}
