import { createServer } from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { discover, registerClient, buildAuthorizeUrl, exchangeCode, type AsMetadata, type FetchFn } from "./oauth.js";
import { generatePkce, randomState, type Pkce } from "./pkce.js";
import { FileTokenStore, type TokenStore } from "./tokenStore.js";

const SCOPE = "balance:read orders:read plans:write offline_access";

function openDefault(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}

interface LoopbackResult {
  code: string;
  redirectUri: string;
  pkce: Pkce;
  clientId: string;
}

function runLoopbackFlow(meta: AsMetadata, mcpUrl: string, f: FetchFn, openBrowser: (url: string) => void): Promise<LoopbackResult> {
  return new Promise<LoopbackResult>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      void (async () => {
        try {
          if (!meta.registrationEndpoint) {
            throw new Error("authorization server has no registration_endpoint; a pre-registered client_id is required");
          }
          const port = (server.address() as AddressInfo).port;
          const redirectUri = `http://127.0.0.1:${port}/callback`;
          const clientId = await registerClient(meta.registrationEndpoint, redirectUri, f);
          const pkce = generatePkce();
          const state = randomState();
          const authUrl = buildAuthorizeUrl({
            authorizationEndpoint: meta.authorizationEndpoint,
            clientId,
            redirectUri,
            challenge: pkce.challenge,
            state,
            scope: SCOPE,
            resource: mcpUrl,
          });

          server.on("request", (req, res) => {
            const u = new URL(req.url ?? "/", redirectUri);
            if (u.pathname !== "/callback") {
              res.writeHead(404).end();
              return;
            }
            res.writeHead(200, { "content-type": "text/html" }).end(
              "<html><body><h3>SpreadX login complete</h3>You can close this tab and return to the terminal.</body></html>",
            );
            server.close();
            const err = u.searchParams.get("error");
            if (err) return reject(new Error(`authorization error: ${err}`));
            if (u.searchParams.get("state") !== state) return reject(new Error("state mismatch (possible CSRF) — aborting"));
            const code = u.searchParams.get("code");
            if (!code) return reject(new Error("authorization callback had no code"));
            resolve({ code, redirectUri, pkce, clientId });
          });

          // eslint-disable-next-line no-console
          console.error(`Opening your browser to authorize SpreadX.\nIf it doesn't open, visit:\n${authUrl}\n`);
          openBrowser(authUrl);
        } catch (e) {
          server.close();
          reject(e);
        }
      })();
    });
  });
}

/**
 * One-time browser authorization. Discovers the AS from the MCP resource, runs
 * Auth Code + PKCE on a loopback redirect, and stores the rotating refresh token.
 * After this, the harness refreshes access tokens unattended.
 */
export async function login(
  mcpUrl: string,
  deps: { store?: TokenStore; fetchFn?: FetchFn; openBrowser?: (url: string) => void } = {},
): Promise<void> {
  const f = deps.fetchFn ?? fetch;
  const store = deps.store ?? new FileTokenStore();
  const meta = await discover(mcpUrl, f);
  const { code, redirectUri, pkce, clientId } = await runLoopbackFlow(meta, mcpUrl, f, deps.openBrowser ?? openDefault);
  const tok = await exchangeCode(
    { tokenEndpoint: meta.tokenEndpoint, clientId, code, verifier: pkce.verifier, redirectUri, resource: mcpUrl },
    f,
  );
  if (!tok.refresh_token) {
    throw new Error("authorization server returned no refresh_token (the 'offline_access' scope is required for unattended use)");
  }
  const now = Math.floor(Date.now() / 1000);
  await store.save(mcpUrl, {
    issuer: meta.issuer,
    tokenEndpoint: meta.tokenEndpoint,
    clientId,
    refreshToken: tok.refresh_token,
    accessToken: tok.access_token,
    expiresAt: tok.expires_in ? now + tok.expires_in : undefined,
  });
}
