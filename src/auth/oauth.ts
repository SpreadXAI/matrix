// OAuth 2.1 client primitives for the SpreadX MCP server. All network calls take
// an injectable `fetch` so the logic is unit-testable without a live AS. Follows
// the MCP authorization spec: RFC 9728 protected-resource discovery, RFC 8414 AS
// metadata, S256 PKCE (mandatory), RFC 8707 resource indicator.

export type FetchFn = typeof fetch;

export interface AsMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export class TokenError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TokenError";
  }
}

const slash = (u: string): string => (u.endsWith("/") ? u : `${u}/`);

/** RFC 9728 → RFC 8414 discovery starting from the MCP resource URL. */
export async function discover(mcpUrl: string, f: FetchFn): Promise<AsMetadata> {
  const prmRes = await f(new URL(".well-known/oauth-protected-resource", slash(mcpUrl)).toString());
  if (!prmRes.ok) throw new Error(`protected-resource metadata: HTTP ${prmRes.status}`);
  const prm = (await prmRes.json()) as { authorization_servers?: string[] };
  const issuer = prm.authorization_servers?.[0];
  if (!issuer) throw new Error("protected-resource metadata has no authorization_servers");

  const asRes = await f(new URL(".well-known/oauth-authorization-server", slash(issuer)).toString());
  if (!asRes.ok) throw new Error(`authorization-server metadata: HTTP ${asRes.status}`);
  const m = (await asRes.json()) as {
    issuer?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
    code_challenge_methods_supported?: string[];
  };
  if (!m.code_challenge_methods_supported?.includes("S256")) {
    throw new Error("authorization server does not advertise S256 PKCE — refusing (OAuth 2.1)");
  }
  if (!m.authorization_endpoint || !m.token_endpoint) {
    throw new Error("authorization server metadata missing authorization_endpoint/token_endpoint");
  }
  return {
    issuer: m.issuer ?? issuer,
    authorizationEndpoint: m.authorization_endpoint,
    tokenEndpoint: m.token_endpoint,
  };
}

export function buildAuthorizeUrl(p: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scope: string;
  resource: string;
}): string {
  const u = new URL(p.authorizationEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", p.state);
  u.searchParams.set("scope", p.scope);
  u.searchParams.set("resource", p.resource); // RFC 8707
  return u.toString();
}

async function tokenRequest(endpoint: string, params: Record<string, string>, f: FetchFn): Promise<TokenResponse> {
  const res = await f(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new TokenError(`token endpoint HTTP ${res.status}: ${detail}`, res.status);
  }
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(
  p: { tokenEndpoint: string; clientId: string; code: string; verifier: string; redirectUri: string; resource: string },
  f: FetchFn,
): Promise<TokenResponse> {
  return tokenRequest(
    p.tokenEndpoint,
    {
      grant_type: "authorization_code",
      code: p.code,
      code_verifier: p.verifier,
      redirect_uri: p.redirectUri,
      client_id: p.clientId,
      resource: p.resource,
    },
    f,
  );
}

export function refresh(
  p: { tokenEndpoint: string; clientId: string; refreshToken: string; resource: string },
  f: FetchFn,
): Promise<TokenResponse> {
  return tokenRequest(
    p.tokenEndpoint,
    {
      grant_type: "refresh_token",
      refresh_token: p.refreshToken,
      client_id: p.clientId,
      resource: p.resource,
    },
    f,
  );
}
