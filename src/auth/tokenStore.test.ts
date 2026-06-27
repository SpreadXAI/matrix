import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTokenStore, type StoredCreds } from "./tokenStore.js";

const creds = (over: Partial<StoredCreds> = {}): StoredCreds => ({
  issuer: "https://as.example",
  tokenEndpoint: "https://as.example/oauth/token",
  clientId: "client-1",
  refreshToken: "rt-1",
  ...over,
});

describe("FileTokenStore", () => {
  let dir: string;
  let path: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "matrix-store-"));
    path = join(dir, "nested", "credentials.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null before anything is saved", async () => {
    expect(await new FileTokenStore(path).load("https://mcp.x/")).toBeNull();
  });

  it("saves and loads per-mcpUrl, writing a 0600 file", async () => {
    const store = new FileTokenStore(path);
    await store.save("https://mcp.x/", creds({ refreshToken: "rt-x" }));
    await store.save("https://mcp.staging/", creds({ refreshToken: "rt-staging" }));
    expect((await store.load("https://mcp.x/"))?.refreshToken).toBe("rt-x");
    expect((await store.load("https://mcp.staging/"))?.refreshToken).toBe("rt-staging");
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("clear removes one entry and deletes the file when empty", async () => {
    const store = new FileTokenStore(path);
    await store.save("https://mcp.x/", creds());
    await store.clear("https://mcp.x/");
    expect(await store.load("https://mcp.x/")).toBeNull();
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
