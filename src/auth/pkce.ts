import { randomBytes, createHash } from "node:crypto";

export interface Pkce {
  verifier: string;
  challenge: string;
  method: "S256";
}

/** RFC 7636 PKCE: a high-entropy verifier and its S256 challenge. */
export function generatePkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, method: "S256" };
}

/** Opaque CSRF state for the authorization request. */
export function randomState(): string {
  return randomBytes(16).toString("base64url");
}
