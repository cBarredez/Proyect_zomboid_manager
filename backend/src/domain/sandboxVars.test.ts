import { describe, expect, it } from "vitest";
import { applySandboxUpdates, parseSandboxVars } from "./sandboxVars.js";

const SAMPLE = `SandboxVars = {
\tVERSION = 5,
\tZombies = 4,
\tDistribution = "urbanfocused",
\tDayLength = 4,
\tStarterKit = false,
\tZombieLore = {
\t\tSpeed = 2,
\t\tStrength = 2,
\t\tToughness = 2,
\t},
\tPVP = true,
}
`;

describe("parseSandboxVars", () => {
  it("groups flat top-level fields under General", () => {
    const groups = parseSandboxVars(SAMPLE);
    const general = groups.find((g) => g.name === "General")!;
    const paths = general.fields.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["VERSION", "Zombies", "Distribution", "DayLength", "StarterKit", "PVP"]));
  });

  it("groups nested table fields under a humanized group name", () => {
    const groups = parseSandboxVars(SAMPLE);
    const zombieLore = groups.find((g) => g.name === "Zombie Lore")!;
    expect(zombieLore.fields.map((f) => f.path).sort()).toEqual([
      "ZombieLore.Speed",
      "ZombieLore.Strength",
      "ZombieLore.Toughness",
    ]);
  });

  it("infers correct types", () => {
    const groups = parseSandboxVars(SAMPLE);
    const all = groups.flatMap((g) => g.fields);
    expect(all.find((f) => f.path === "Zombies")).toMatchObject({ type: "number", value: 4 });
    expect(all.find((f) => f.path === "Distribution")).toMatchObject({ type: "string", value: "urbanfocused" });
    expect(all.find((f) => f.path === "StarterKit")).toMatchObject({ type: "boolean", value: false });
    expect(all.find((f) => f.path === "ZombieLore.Speed")).toMatchObject({ type: "number", value: 2 });
  });
});

describe("applySandboxUpdates", () => {
  it("patches a top-level number field in place", () => {
    const result = applySandboxUpdates(SAMPLE, [{ path: "Zombies", value: 2 }]);
    expect(result).toContain("Zombies = 2,");
    expect(parseSandboxVars(result).flatMap((g) => g.fields).find((f) => f.path === "Zombies")?.value).toBe(2);
  });

  it("patches a nested field without disturbing sibling fields", () => {
    const result = applySandboxUpdates(SAMPLE, [{ path: "ZombieLore.Speed", value: 3 }]);
    const fields = parseSandboxVars(result).flatMap((g) => g.fields);
    expect(fields.find((f) => f.path === "ZombieLore.Speed")?.value).toBe(3);
    expect(fields.find((f) => f.path === "ZombieLore.Strength")?.value).toBe(2);
  });

  it("preserves quoting when patching a string field", () => {
    const result = applySandboxUpdates(SAMPLE, [{ path: "Distribution", value: "forest" }]);
    expect(result).toContain('Distribution = "forest",');
  });

  it("patches a boolean field", () => {
    const result = applySandboxUpdates(SAMPLE, [{ path: "StarterKit", value: true }]);
    expect(result).toContain("StarterKit = true,");
  });

  it("applies multiple updates in one pass", () => {
    const result = applySandboxUpdates(SAMPLE, [
      { path: "Zombies", value: 1 },
      { path: "PVP", value: false },
    ]);
    const fields = parseSandboxVars(result).flatMap((g) => g.fields);
    expect(fields.find((f) => f.path === "Zombies")?.value).toBe(1);
    expect(fields.find((f) => f.path === "PVP")?.value).toBe(false);
  });

  it("throws on an unknown path", () => {
    expect(() => applySandboxUpdates(SAMPLE, [{ path: "DoesNotExist", value: 1 }])).toThrow(/unknown/);
  });

  it("throws on a type mismatch", () => {
    expect(() => applySandboxUpdates(SAMPLE, [{ path: "Zombies", value: "not-a-number" }])).toThrow(/expects/);
  });
});
