import { describe, it, expect } from "vitest";
import { discover, buildAuthorizeUrl, exchangeCode, refresh, type FetchFn } from "./oauth.js";

const json = (body: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

/** A fetch fake that routes by URL substring and records the last request. */
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

describe("discover", () => {
  it("follows RFC 9728 → RFC 8414 and returns AS endpoints", async () => {
    const { fn } = fakeFetch({
      "/.well-known/oauth-protected-resource": json({ authorization_servers: ["https://as.example"] }),
      "/.well-known/oauth-authorization-server": json({
        issuer: "https://as.example",
        authorization_endpoint: "https://as.example/oauth/authorize",
        token_endpoint: "https://as.example/oauth/token",
        code_challenge_methods_supported: ["S256"],
      }),
    });
    const meta = await discover("https://mcp.spreadx.ai/", fn);
    expect(meta).toMatchObject({
      authorizationEndpoint: "https://as.example/oauth/authorize",
      tokenEndpoint: "https://as.example/oauth/token",
    });
    expect(meta).not.toHaveProperty("registrationEndpoint");
  });

  it("refuses an AS that does not advertise S256 PKCE", async () => {
    const { fn } = fakeFetch({
      "/.well-known/oauth-protected-resource": json({ authorization_servers: ["https://as.example"] }),
      "/.well-known/oauth-authorization-server": json({
        authorization_endpoint: "a",
        token_endpoint: "t",
        code_challenge_methods_supported: ["plain"],
      }),
    });
    await expect(discover("https://mcp.spreadx.ai/", fn)).rejects.toThrow(/S256/);
  });
});

describe("buildAuthorizeUrl", () => {
  it("includes PKCE S256, state, scope, and the RFC 8707 resource", () => {
    const url = new URL(
      buildAuthorizeUrl({
        authorizationEndpoint: "https://as.example/oauth/authorize",
        clientId: "c1",
        redirectUri: "http://127.0.0.1:5555/callback",
        challenge: "CHAL",
        state: "ST",
        scope: "balance:read offline_access",
        resource: "https://mcp.spreadx.ai/",
      }),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("CHAL");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("ST");
    expect(url.searchParams.get("resource")).toBe("https://mcp.spreadx.ai/");
  });
});

describe("token requests", () => {
  it("exchangeCode posts the authorization_code grant with the verifier", async () => {
    const { fn, calls } = fakeFetch({ "/oauth/token": json({ access_token: "at", refresh_token: "rt", expires_in: 900 }) });
    const tok = await exchangeCode(
      { tokenEndpoint: "https://as.example/oauth/token", clientId: "c1", code: "CODE", verifier: "VER", redirectUri: "http://127.0.0.1/cb", resource: "https://mcp.spreadx.ai/" },
      fn,
    );
    expect(tok.access_token).toBe("at");
    const body = String(calls[0].init?.body);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code_verifier=VER");
    expect(body).toContain("resource=https");
  });

  it("refresh posts the refresh_token grant", async () => {
    const { fn, calls } = fakeFetch({ "/oauth/token": json({ access_token: "at2", refresh_token: "rt2" }) });
    const tok = await refresh(
      { tokenEndpoint: "https://as.example/oauth/token", clientId: "c1", refreshToken: "rt1", resource: "https://mcp.spreadx.ai/" },
      fn,
    );
    expect(tok).toMatchObject({ access_token: "at2", refresh_token: "rt2" });
    expect(String(calls[0].init?.body)).toContain("grant_type=refresh_token");
  });

  it("throws TokenError with the status on a non-2xx token response", async () => {
    const { fn } = fakeFetch({ "/oauth/token": json({ error: "invalid_grant" }, false, 400) });
    await expect(
      refresh({ tokenEndpoint: "https://as.example/oauth/token", clientId: "c1", refreshToken: "bad", resource: "r" }, fn),
    ).rejects.toMatchObject({ status: 400 });
  });
});
