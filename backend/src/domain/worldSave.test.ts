import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerPaths } from "./serverPaths.js";
import { eraseWorldSave, worldSaveExists } from "./worldSave.js";

describe("world saves", () => {
  it("erases only the selected world and player database", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "pz-world-"));
    const paths = { dataDir } as ServerPaths;
    try {
      const worldDir = path.join(dataDir, "Saves", "Multiplayer", "servertest");
      const dbDir = path.join(dataDir, "db");
      await mkdir(worldDir, { recursive: true });
      await mkdir(dbDir, { recursive: true });
      await writeFile(path.join(worldDir, "map.bin"), "world");
      await writeFile(path.join(dbDir, "servertest.db"), "players");
      await writeFile(path.join(dbDir, "other.db"), "keep");

      expect(await worldSaveExists(paths, "servertest")).toBe(true);
      await eraseWorldSave(paths, "servertest");
      expect(await worldSaveExists(paths, "servertest")).toBe(false);
      expect(await worldSaveExists(paths, "other")).toBe(true);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
