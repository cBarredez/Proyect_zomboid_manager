import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwordHasher.js";

describe("passwordHasher", () => {
  it("verifies a correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("produces a different hash each time (random salt)", () => {
    expect(hashPassword("same-password")).not.toBe(hashPassword("same-password"));
  });

  it("rejects malformed stored hashes", () => {
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
  });
});
