import { describe, expect, it } from "vitest";
import { createSessionProof, verifySessionProof } from "./sessionProof.js";

const SECRET = "test-secret";

describe("sessionProof", () => {
  it("round-trips a valid token", () => {
    const token = createSessionProof("admin", SECRET);
    const result = verifySessionProof(token, SECRET);
    expect(result).toEqual({ valid: true, username: "admin" });
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSessionProof("admin", SECRET);
    expect(verifySessionProof(token, "other-secret").valid).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const token = createSessionProof("admin", SECRET);
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ username: "root", issuedAt: Date.now() })).toString(
      "base64url",
    );
    expect(verifySessionProof(`${forgedPayload}.${signature}`, SECRET).valid).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = createSessionProof("admin", SECRET, Date.now() - 1_000_000);
    expect(verifySessionProof(token, SECRET, Date.now(), 500).valid).toBe(false);
  });

  it("rejects a missing token", () => {
    expect(verifySessionProof(undefined, SECRET).valid).toBe(false);
  });
});
