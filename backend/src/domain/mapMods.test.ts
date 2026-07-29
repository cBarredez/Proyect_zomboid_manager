import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerPaths } from "./serverPaths.js";
import { discoverMapComponents, mapConflicts, mergeMapConfig } from "./mapMods.js";

describe("map mod discovery", () => {
  it("discovers a Build 42 map, spawn points, and occupied cells", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pz-maps-"));
    const workshopContentDir = path.join(root, "108600");
    const modRoot = path.join(workshopContentDir, "123", "mods", "Example", "42");
    const mapRoot = path.join(modRoot, "media", "maps", "Example City");
    await mkdir(mapRoot, { recursive: true });
    await writeFile(path.join(modRoot, "mod.info"), "id=Example\nname=Example Map\n");
    await writeFile(path.join(mapRoot, "map.info"), "title=Example City\n");
    await writeFile(path.join(mapRoot, "spawnpoints.lua"), "return {}\n");
    await writeFile(path.join(mapRoot, "10_20.lotheader"), "");
    try {
      const components = await discoverMapComponents({ workshopContentDir } as ServerPaths);
      expect(components).toEqual([
        expect.objectContaining({
          workshopId: "123",
          modId: "Example",
          mapFolder: "Example City",
          compatibility: "build42",
          hasSpawnPoints: true,
          cells: ["10_20"],
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports overlapping cells only for enabled maps", () => {
    const components = [
      { key: "a", workshopId: "1", modId: "a", modName: "A", mapFolder: "A", compatibility: "build41" as const, hasSpawnPoints: false, cells: ["1_2"] },
      { key: "b", workshopId: "2", modId: "b", modName: "B", mapFolder: "B", compatibility: "build42" as const, hasSpawnPoints: false, cells: ["1_2"] },
    ];
    const enabled = mergeMapConfig(components);
    expect(mapConflicts(components, enabled)).toEqual([{ cell: "1_2", maps: ["A", "B"] }]);
    enabled.entries[1].enabled = false;
    expect(mapConflicts(components, enabled)).toEqual([]);
  });
});
