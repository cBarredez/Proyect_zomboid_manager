import { describe, expect, it } from "vitest";
import { statusPresentation } from "./client.js";

describe("statusPresentation", () => {
  it("maps running to positive", () => {
    expect(statusPresentation("running")).toEqual({ label: "Running", tone: "positive" });
  });

  it("maps idle to neutral/Stopped", () => {
    expect(statusPresentation("idle")).toEqual({ label: "Stopped", tone: "neutral" });
  });

  it("maps crashed to negative", () => {
    expect(statusPresentation("crashed")).toEqual({ label: "Crashed", tone: "negative" });
  });

  it("maps starting/stopping to warning", () => {
    expect(statusPresentation("starting").tone).toBe("warning");
    expect(statusPresentation("stopping").tone).toBe("warning");
  });
});
