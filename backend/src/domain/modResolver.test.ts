import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findMissingDependencies, parseModInfo, resolveModsInWorkshopItem } from "./modResolver.js";

describe("parseModInfo", () => {
  it("extracts id and name", () => {
    const info = parseModInfo("id=MyMod\nname=My Cool Mod\nversion=1.0", "/some/path");
    expect(info).toEqual({ id: "MyMod", name: "My Cool Mod", folderPath: "/some/path", requires: [] });
  });

  it("falls back to id when name is absent", () => {
    const info = parseModInfo("id=MyMod\n", "/some/path");
    expect(info?.name).toBe("MyMod");
  });

  it("returns null when id is missing", () => {
    expect(parseModInfo("name=Only Name\n", "/some/path")).toBeNull();
  });

  it("parses a comma-separated Require= list", () => {
    const info = parseModInfo("id=MyMod\nRequire=Base,Other Mod\n", "/some/path");
    expect(info?.requires).toEqual(["Base", "Other Mod"]);
  });

  it("parses a semicolon-separated Require= list", () => {
    const info = parseModInfo("id=MyMod\nRequire=Base;Other\n", "/some/path");
    expect(info?.requires).toEqual(["Base", "Other"]);
  });
});

describe("findMissingDependencies", () => {
  it("returns dependencies not present among the given mods", () => {
    const mods = [
      { id: "A", name: "A", folderPath: "/a", requires: ["B", "C"] },
      { id: "B", name: "B", folderPath: "/b", requires: [] },
    ];
    expect(findMissingDependencies(mods)).toEqual(["C"]);
  });

  it("returns an empty array when all dependencies are satisfied", () => {
    const mods = [
      { id: "A", name: "A", folderPath: "/a", requires: ["B"] },
      { id: "B", name: "B", folderPath: "/b", requires: [] },
    ];
    expect(findMissingDependencies(mods)).toEqual([]);
  });
});

describe("resolveModsInWorkshopItem", () => {
  it("finds a mod.info at the top level", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pz-workshop-"));
    try {
      await writeFile(path.join(dir, "mod.info"), "id=TopLevel\nname=Top Level Mod\n", "utf-8");
      const mods = await resolveModsInWorkshopItem(dir);
      expect(mods.map((m) => m.id)).toEqual(["TopLevel"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("finds multiple mods bundled under a mods/ subfolder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pz-workshop-"));
    try {
      await mkdir(path.join(dir, "mods", "ModA"), { recursive: true });
      await mkdir(path.join(dir, "mods", "ModB"), { recursive: true });
      await writeFile(path.join(dir, "mods", "ModA", "mod.info"), "id=ModA\nname=Mod A\n", "utf-8");
      await writeFile(path.join(dir, "mods", "ModB", "mod.info"), "id=ModB\nname=Mod B\n", "utf-8");

      const mods = await resolveModsInWorkshopItem(dir);
      expect(mods.map((m) => m.id).sort()).toEqual(["ModA", "ModB"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("finds Build 42 versioned mod.info files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pz-workshop-"));
    try {
      const versionDir = path.join(dir, "mods", "VersionedMod", "42");
      await mkdir(versionDir, { recursive: true });
      await writeFile(
        path.join(versionDir, "mod.info"),
        "id=Versioned42\nname=Versioned B42 Mod\n",
        "utf-8",
      );
      const mods = await resolveModsInWorkshopItem(dir);
      expect(mods.map((mod) => mod.id)).toEqual(["Versioned42"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty array when nothing is found", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pz-workshop-"));
    try {
      expect(await resolveModsInWorkshopItem(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
