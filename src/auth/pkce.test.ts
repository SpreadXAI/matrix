import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generatePkce, randomState } from "./pkce.js";

describe("pkce", () => {
  it("challenge is the base64url S256 hash of the verifier", () => {
    const { verifier, challenge, method } = generatePkce();
    expect(method).toBe("S256");
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    // base64url: no +, /, or = padding
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("generates distinct verifiers and states", () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
    expect(randomState()).not.toBe(randomState());
  });
});
