import { describe, it, expect } from "vitest";
import { formatAuthStatus } from "./status.js";
import type { StoredCreds } from "./tokenStore.js";

const NOW = 1_000_000;
const creds = (over: Partial<StoredCreds> = {}): StoredCreds => ({
  issuer: "https://as.example",
  tokenEndpoint: "https://as.example/oauth/token",
  clientId: "c1",
  refreshToken: "rt-1",
  ...over,
});

describe("formatAuthStatus", () => {
  it("tells the user to log in when there are no credentials", () => {
    expect(formatAuthStatus("https://mcp.x/", null, NOW)).toMatch(/matrix login/);
  });
  it("reports remaining validity for a live access token without leaking it", () => {
    const s = formatAuthStatus("https://mcp.x/", creds({ accessToken: "SECRET_TOKEN_VALUE", expiresAt: NOW + 125 }), NOW);
    expect(s).toContain("Logged in to https://mcp.x/");
    expect(s).toMatch(/valid for 2m 5s/);
    expect(s).not.toContain("SECRET_TOKEN_VALUE");
    expect(s).not.toContain("rt-1"); // nor the refresh token
  });
  it("reports an expired token as auto-refreshing", () => {
    expect(formatAuthStatus("https://mcp.x/", creds({ accessToken: "at", expiresAt: NOW - 5 }), NOW)).toMatch(/expired/);
  });
  it("notes when no access token is cached yet", () => {
    expect(formatAuthStatus("https://mcp.x/", creds(), NOW)).toMatch(/no access token cached/);
  });
});
