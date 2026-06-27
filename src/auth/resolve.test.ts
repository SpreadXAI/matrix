import { describe, it, expect, vi } from "vitest";
import { resolveAccessToken } from "./resolve.js";
import type { TokenStore, StoredCreds } from "./tokenStore.js";
import type { MatrixConfig } from "../core/config.js";
import type { FetchFn } from "./oauth.js";

const baseConfig = (over: Partial<MatrixConfig> = {}): MatrixConfig => ({
  mcpUrl: "https://mcp.spreadx.ai/",
  bearerToken: undefined,
  model: "claude-sonnet-4-6",
  mode: "headless",
  caps: { follow: 1000, engagement: 500 },
  autoApproveWrites: false,
  ...over,
});

function memStore(initial: StoredCreds | null): TokenStore & { saved?: StoredCreds } {
  let cur = initial;
  const s: TokenStore & { saved?: StoredCreds } = {
    load: async () => cur,
    save: async (_url, c) => {
      cur = c;
      s.saved = c;
    },
    clear: async () => {
      cur = null;
    },
  };
  return s;
}

const okToken = (body: unknown): FetchFn =>
  (async () => ({ ok: true, status: 200, json: async () => body, text: async () => "" }) as unknown as Response) as unknown as FetchFn;

const NOW = 1_000_000;
const creds = (over: Partial<StoredCreds> = {}): StoredCreds => ({
  issuer: "https://as.example",
  tokenEndpoint: "https://as.example/oauth/token",
  clientId: "c1",
  refreshToken: "rt-1",
  ...over,
});

describe("resolveAccessToken", () => {
  it("returns undefined for the mock (no token needed)", async () => {
    expect(await resolveAccessToken(baseConfig({ mcpUrl: "mock" }), { store: memStore(null) })).toBeUndefined();
  });

  it("prefers the explicit env token and never touches the store", async () => {
    const store = memStore(null);
    const spy = vi.spyOn(store, "load");
    expect(await resolveAccessToken(baseConfig({ bearerToken: "env-token" }), { store })).toBe("env-token");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reuses a still-valid stored access token without refreshing", async () => {
    const store = memStore(creds({ accessToken: "cached", expiresAt: NOW + 600 }));
    const fetchFn = vi.fn();
    const t = await resolveAccessToken(baseConfig(), { store, fetchFn: fetchFn as unknown as FetchFn, now: () => NOW });
    expect(t).toBe("cached");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refreshes when the access token is expired and persists the rotated refresh token", async () => {
    const store = memStore(creds({ accessToken: "old", expiresAt: NOW - 10 }));
    const t = await resolveAccessToken(baseConfig(), {
      store,
      fetchFn: okToken({ access_token: "fresh", refresh_token: "rt-2", expires_in: 900 }),
      now: () => NOW,
    });
    expect(t).toBe("fresh");
    expect(store.saved).toMatchObject({ accessToken: "fresh", refreshToken: "rt-2", expiresAt: NOW + 900 });
  });

  it("throws a 'matrix login' hint when there are no stored credentials", async () => {
    await expect(resolveAccessToken(baseConfig(), { store: memStore(null) })).rejects.toThrow(/matrix login/);
  });
});
