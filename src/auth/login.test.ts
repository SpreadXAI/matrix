import { describe, it, expect, vi, beforeEach } from "vitest";
import { login, SPREADX_CLIENT_ID } from "./login.js";
import type { FetchFn } from "./oauth.js";
import type { StoredCreds, TokenStore } from "./tokenStore.js";

const MCP_URL = "https://mcp.spreadx.ai/";

const json = (body: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

/** A fetch fake that routes by URL substring and records each request. */
function fakeFetch(routes: Record<string, Response>): { fn: FetchFn; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = url.toString();
    calls.push({ url: u, init });
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) throw new Error(`no route for ${u}`);
    return routes[key];
  }) as unknown as FetchFn;
  return { fn, calls };
}

/** An in-memory TokenStore double that records save() calls. */
function fakeStore(): { store: TokenStore; saves: { mcpUrl: string; creds: StoredCreds }[] } {
  const saves: { mcpUrl: string; creds: StoredCreds }[] = [];
  const store: TokenStore = {
    load: async () => null,
    save: async (mcpUrl, creds) => {
      saves.push({ mcpUrl, creds });
    },
    clear: async () => {},
  };
  return { store, saves };
}

const asRoutes = (tokenResponse: unknown): Record<string, Response> => ({
  "/.well-known/oauth-protected-resource": json({ authorization_servers: ["https://as.example"] }),
  "/.well-known/oauth-authorization-server": json({
    issuer: "https://as.example",
    authorization_endpoint: "https://as.example/oauth/authorize",
    token_endpoint: "https://as.example/oauth/token",
    code_challenge_methods_supported: ["S256"],
  }),
  "/oauth/token": json(tokenResponse),
});

const OK_TOKEN = { access_token: "at", refresh_token: "rt", expires_in: 900 };

/**
 * Start `login` and drive its loopback callback with `drive(authUrl)`, which
 * stands in for the browser hitting the redirect URI after consent. Returns the
 * pending promise plus the recorded fetch calls / store saves / authorize URL.
 */
function loginWith(drive: (authUrl: URL) => void, tokenResponse: unknown = OK_TOKEN) {
  const { fn, calls } = fakeFetch(asRoutes(tokenResponse));
  const { store, saves } = fakeStore();
  let authUrl = "";
  const openBrowser = (url: string): void => {
    authUrl = url;
    drive(new URL(url));
  };
  const done = login(MCP_URL, { store, fetchFn: fn, openBrowser });
  return { done, calls, saves, getAuthUrl: () => authUrl };
}

/** Happy-path browser: approve and return a valid code echoing the real state. */
const approve = (u: URL): void => {
  const redirectUri = u.searchParams.get("redirect_uri") ?? "";
  const state = u.searchParams.get("state") ?? "";
  void fetch(`${redirectUri}?code=TESTCODE&state=${encodeURIComponent(state)}`);
};

/** Run a full successful `login` and return what it recorded. */
async function runLogin(tokenResponse: unknown = OK_TOKEN) {
  const h = loginWith(approve, tokenResponse);
  await h.done;
  return h;
}

describe("login", () => {
  // login prints the authorize URL to stderr for the human; keep test output clean.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("makes no dynamic client registration request", async () => {
    const { calls } = await runLogin();
    expect(calls.some((c) => c.url.includes("register"))).toBe(false);
  });

  it("builds an authorize URL with the baked client_id, S256, offline_access scope, and resource", async () => {
    const { getAuthUrl } = await runLogin();
    const u = new URL(getAuthUrl());
    expect(u.searchParams.get("client_id")).toBe(SPREADX_CLIENT_ID);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toContain("offline_access");
    expect(u.searchParams.get("resource")).toBe(MCP_URL);
  });

  it("persists the baked client_id and the rotating refresh token", async () => {
    const { saves } = await runLogin();
    expect(saves).toHaveLength(1);
    expect(saves[0].mcpUrl).toBe(MCP_URL);
    expect(saves[0].creds.clientId).toBe(SPREADX_CLIENT_ID);
    expect(saves[0].creds.refreshToken).toBe("rt");
  });

  it("throws when the token response has no refresh_token (offline_access required)", async () => {
    await expect(runLogin({ access_token: "at" })).rejects.toThrow(/offline_access|refresh_token/);
  });

  it("rejects when the authorization server returns an error", async () => {
    const { done, saves } = loginWith((u) => {
      const redirectUri = u.searchParams.get("redirect_uri") ?? "";
      const state = u.searchParams.get("state") ?? "";
      void fetch(`${redirectUri}?error=access_denied&state=${encodeURIComponent(state)}`);
    });
    await expect(done).rejects.toThrow(/authorization error: access_denied/);
    expect(saves).toHaveLength(0);
  });

  it("rejects on state mismatch (CSRF guard) without exchanging the code", async () => {
    const { done, calls, saves } = loginWith((u) => {
      const redirectUri = u.searchParams.get("redirect_uri") ?? "";
      void fetch(`${redirectUri}?code=TESTCODE&state=forged-state`);
    });
    await expect(done).rejects.toThrow(/state mismatch/);
    expect(calls.some((c) => c.url.includes("/oauth/token"))).toBe(false);
    expect(saves).toHaveLength(0);
  });

  it("rejects when the callback has no code", async () => {
    const { done } = loginWith((u) => {
      const redirectUri = u.searchParams.get("redirect_uri") ?? "";
      const state = u.searchParams.get("state") ?? "";
      void fetch(`${redirectUri}?state=${encodeURIComponent(state)}`);
    });
    await expect(done).rejects.toThrow(/no code/);
  });
});
