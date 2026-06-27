import { mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export interface StoredCreds {
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
  accessToken?: string;
  /** epoch seconds when the access token expires */
  expiresAt?: number;
}

export interface TokenStore {
  load(mcpUrl: string): Promise<StoredCreds | null>;
  save(mcpUrl: string, creds: StoredCreds): Promise<void>;
  clear(mcpUrl: string): Promise<void>;
}

export function defaultCredentialsPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "spreadx-matrix", "credentials.json");
}

/**
 * Refresh tokens persisted to a 0600 file under the user config dir, keyed by
 * MCP server URL (so staging and prod never collide). v1 store; a macOS
 * Keychain implementation can replace this behind the same interface later.
 */
export class FileTokenStore implements TokenStore {
  constructor(private readonly path: string = defaultCredentialsPath()) {}

  private async readAll(): Promise<Record<string, StoredCreds>> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as Record<string, StoredCreds>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw e;
    }
  }

  private async writeAll(all: Record<string, StoredCreds>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(all, null, 2), { mode: 0o600 });
    await chmod(this.path, 0o600);
  }

  async load(mcpUrl: string): Promise<StoredCreds | null> {
    return (await this.readAll())[mcpUrl] ?? null;
  }

  async save(mcpUrl: string, creds: StoredCreds): Promise<void> {
    const all = await this.readAll();
    all[mcpUrl] = creds;
    await this.writeAll(all);
  }

  async clear(mcpUrl: string): Promise<void> {
    const all = await this.readAll();
    delete all[mcpUrl];
    if (Object.keys(all).length === 0) {
      await rm(this.path, { force: true });
      return;
    }
    await this.writeAll(all);
  }
}
