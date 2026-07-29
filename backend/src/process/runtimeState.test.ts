import { describe, expect, it } from "vitest";
import { isServerReadyLine } from "./runtimeState.js";

describe("isServerReadyLine", () => {
  it.each([
    "Dedicated server is now started",
    "Server Steam ID 90289786907103258",
    "LOG : Network > ZNet: Zomboid Server is VAC Secure",
  ])("recognizes a Project Zomboid ready marker: %s", (line) => {
    expect(isServerReadyLine(line)).toBe(true);
  });

  it("does not treat ordinary initialization output as ready", () => {
    expect(isServerReadyLine("LuaNet: Initialization [DONE]")).toBe(false);
  });
});
