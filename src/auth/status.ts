import type { StoredCreds } from "./tokenStore.js";

/** Human-readable auth status for `matrix status`. Never prints token values. */
export function formatAuthStatus(mcpUrl: string, creds: StoredCreds | null, now: number): string {
  if (creds === null) {
    return `Not logged in to ${mcpUrl}.\nRun: matrix login`;
  }
  const lines = [`Logged in to ${mcpUrl}`, `  client:  ${creds.clientId}`, `  issuer:  ${creds.issuer}`];
  if (creds.expiresAt === undefined) {
    lines.push("  token:   no access token cached (one will be fetched on next run)");
  } else {
    const secs = creds.expiresAt - now;
    lines.push(
      secs > 0
        ? `  token:   access token valid for ${Math.floor(secs / 60)}m ${secs % 60}s`
        : "  token:   access token expired (refreshes automatically on next run)",
    );
  }
  return lines.join("\n");
}
