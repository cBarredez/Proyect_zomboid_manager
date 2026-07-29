import { describe, expect, it } from "vitest";
import { buildModLines, normalizeStartupSettings } from "./startupSettings.js";

describe("normalizeStartupSettings", () => {
  it("applies defaults", () => {
    const settings = normalizeStartupSettings("myserver");
    expect(settings.maxPlayers).toBe(16);
    expect(settings.mods).toEqual([]);
  });

  it("clamps maxPlayers into range", () => {
    expect(normalizeStartupSettings("s", { maxPlayers: 0 }).maxPlayers).toBe(1);
    expect(normalizeStartupSettings("s", { maxPlayers: 500 }).maxPlayers).toBe(100);
  });

  it("dedupes and trims mod ids", () => {
    const settings = normalizeStartupSettings("s", { mods: [" ModA", "ModA", "ModB ", ""] });
    expect(settings.mods).toEqual(["ModA", "ModB"]);
  });

  it("ensures memoryMaxMb is never below memoryMinMb", () => {
    const settings = normalizeStartupSettings("s", { memoryMinMb: 4096, memoryMaxMb: 1024 });
    expect(settings.memoryMaxMb).toBe(4096);
  });

  it("defaults betaBranch to empty (stable) and trims whitespace", () => {
    expect(normalizeStartupSettings("s").betaBranch).toBe("");
    expect(normalizeStartupSettings("s", { betaBranch: " unstable " }).betaBranch).toBe("unstable");
  });
});

describe("buildModLines", () => {
  it("joins mod ids with semicolons", () => {
    const settings = normalizeStartupSettings("s", { mods: ["A", "B"], workshopItems: ["1", "2"] });
    expect(buildModLines(settings)).toEqual({ mods: "A;B", workshopItems: "1;2" });
  });
});
