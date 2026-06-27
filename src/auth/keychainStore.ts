import { execFile } from "node:child_process";
import type { TokenStore, StoredCreds } from "./tokenStore.js";

export interface ExecResult { stdout: string; stderr: string; code: number }
export type Exec = (cmd: string, args: string[]) => Promise<ExecResult>;

const realExec: Exec = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : err ? 1 : 0;
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
    });
  });

/**
 * Refresh tokens in the macOS login Keychain (encrypted at rest), one generic
 * password per MCP URL. Same `TokenStore` interface as the file store, so callers
 * don't care which backend is active. The whole `StoredCreds` JSON is the secret.
 *
 * Note: the secret is passed to `security ... -w <json>` on argv, briefly visible
 * to the same user via `ps`. That's an accepted trade for not persisting the token
 * to a plaintext file; the value is encrypted once in the Keychain.
 */
export class KeychainTokenStore implements TokenStore {
  constructor(
    private readonly exec: Exec = realExec,
    private readonly service = "spreadx-matrix",
  ) {}

  async load(mcpUrl: string): Promise<StoredCreds | null> {
    const r = await this.exec("security", ["find-generic-password", "-a", mcpUrl, "-s", this.service, "-w"]);
    if (r.code !== 0) return null; // item-not-found (44) or any error → treat as absent
    const raw = r.stdout.trim();
    if (!raw) return null;
    return JSON.parse(raw) as StoredCreds;
  }

  async save(mcpUrl: string, creds: StoredCreds): Promise<void> {
    // -U updates the item if it already exists, else creates it.
    const r = await this.exec("security", [
      "add-generic-password", "-U", "-a", mcpUrl, "-s", this.service, "-w", JSON.stringify(creds),
    ]);
    if (r.code !== 0) throw new Error(`keychain save failed: ${r.stderr.trim() || `exit ${r.code}`}`);
  }

  async clear(mcpUrl: string): Promise<void> {
    // Ignore "not found" — clearing an absent item is a no-op.
    await this.exec("security", ["delete-generic-password", "-a", mcpUrl, "-s", this.service]);
  }
}
