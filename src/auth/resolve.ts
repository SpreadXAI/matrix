import type { MatrixConfig } from "../core/config.js";
import type { TokenStore } from "./tokenStore.js";
import { refresh, type FetchFn } from "./oauth.js";

export interface ResolveDeps {
  store: TokenStore;
  fetchFn?: FetchFn;
  now?: () => number; // epoch seconds
}

/**
 * Produce the Bearer access token for a run, in priority order:
 *   1. mock URL                  → no token needed
 *   2. SPREADX_ACCESS_TOKEN env  → explicit override (paste-a-token path)
 *   3. stored credentials        → reuse a still-valid access token, else refresh
 *                                  (rotating the refresh token), else tell the
 *                                  user to run `matrix login`.
 */
export async function resolveAccessToken(config: MatrixConfig, deps: ResolveDeps): Promise<string | undefined> {
  if (config.mcpUrl === "mock") return undefined;
  if (config.bearerToken) return config.bearerToken;

  const f = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  const creds = await deps.store.load(config.mcpUrl);
  if (!creds) {
    throw new Error(`No SpreadX credentials for ${config.mcpUrl}. Run: matrix login`);
  }

  // Reuse a non-expired access token (60s safety margin).
  if (creds.accessToken && creds.expiresAt && creds.expiresAt > now() + 60) {
    return creds.accessToken;
  }

  // Refresh. AS rotates refresh tokens for public clients — persist the new one.
  const tok = await refresh(
    { tokenEndpoint: creds.tokenEndpoint, clientId: creds.clientId, refreshToken: creds.refreshToken, resource: config.mcpUrl },
    f,
  );
  await deps.store.save(config.mcpUrl, {
    ...creds,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? creds.refreshToken,
    expiresAt: tok.expires_in ? now() + tok.expires_in : undefined,
  });
  return tok.access_token;
}
