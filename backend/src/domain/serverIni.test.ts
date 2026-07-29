import { describe, expect, it } from "vitest";
import { parseServerIni, upsertIniFields } from "./serverIni.js";

const SAMPLE = `# server settings
PVP=true
PublicName=My Server
PublicDescription=
MaxPlayers=16
Map=Muldraugh, KY
Open=false
`;

describe("parseServerIni", () => {
  it("parses flat key=value fields with inferred types", () => {
    const fields = parseServerIni(SAMPLE);
    expect(fields.find((f) => f.key === "PVP")).toMatchObject({ type: "boolean", value: true });
    expect(fields.find((f) => f.key === "MaxPlayers")).toMatchObject({ type: "number", value: 16 });
    expect(fields.find((f) => f.key === "Map")).toMatchObject({ type: "string", value: "Muldraugh, KY" });
    expect(fields.find((f) => f.key === "PublicDescription")).toMatchObject({ type: "string", value: "" });
  });

  it("skips comments and blank lines", () => {
    const fields = parseServerIni(SAMPLE);
    expect(fields.some((f) => f.key.startsWith("#"))).toBe(false);
  });

  it("humanizes labels", () => {
    const fields = parseServerIni(SAMPLE);
    expect(fields.find((f) => f.key === "PublicName")?.label).toBe("Public Name");
  });
});

describe("upsertIniFields", () => {
  it("patches an existing key in place", () => {
    const result = upsertIniFields(SAMPLE, [{ key: "MaxPlayers", value: 32 }]);
    expect(result).toContain("MaxPlayers=32");
    expect(parseServerIni(result).find((f) => f.key === "PVP")?.value).toBe(true);
  });

  it("appends a new key that doesn't exist yet", () => {
    const result = upsertIniFields(SAMPLE, [{ key: "RCONPort", value: 27015 }]);
    expect(result).toContain("RCONPort=27015");
    expect(parseServerIni(result).find((f) => f.key === "MaxPlayers")?.value).toBe(16);
  });

  it("creates keys in an empty file", () => {
    const result = upsertIniFields("", [{ key: "Mods", value: "ModA;ModB" }]);
    expect(result.trim()).toBe("Mods=ModA;ModB");
  });

  it("rejects edits to guarded keys", () => {
    expect(() =>
      upsertIniFields(SAMPLE, [{ key: "MaxPlayers", value: 10 }], { guardedKeys: new Set(["MaxPlayers"]) }),
    ).toThrow(/managed automatically/);
  });

  it("throws on a type mismatch for an existing key (strict mode, the default)", () => {
    expect(() => upsertIniFields(SAMPLE, [{ key: "MaxPlayers", value: "not-a-number" }])).toThrow(/expects/);
  });

  it("overwrites instead of throwing on a type mismatch when strict is false", () => {
    const result = upsertIniFields(SAMPLE, [{ key: "MaxPlayers", value: "oops" }], { strict: false });
    expect(result).toContain("MaxPlayers=oops");
  });

  it("preserves an empty string value round-trip", () => {
    const result = upsertIniFields(SAMPLE, [{ key: "PublicDescription", value: "Welcome!" }]);
    expect(result).toContain("PublicDescription=Welcome!");
  });
});
