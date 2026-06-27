import { describe, it, expect, vi } from "vitest";
import { KeychainTokenStore, type Exec, type ExecResult } from "./keychainStore.js";
import type { StoredCreds } from "./tokenStore.js";

const creds: StoredCreds = {
  issuer: "https://as.example",
  tokenEndpoint: "https://as.example/oauth/token",
  clientId: "c1",
  refreshToken: "rt-1",
};

const ok = (stdout = ""): ExecResult => ({ stdout, stderr: "", code: 0 });
const fail = (code = 44, stderr = "not found"): ExecResult => ({ stdout: "", stderr, code });

describe("KeychainTokenStore", () => {
  it("load returns null when the item is not found", async () => {
    const exec: Exec = vi.fn(async () => fail());
    expect(await new KeychainTokenStore(exec).load("https://mcp.x/")).toBeNull();
  });

  it("load parses the stored JSON secret", async () => {
    const exec: Exec = vi.fn(async () => ok(`${JSON.stringify(creds)}\n`));
    expect(await new KeychainTokenStore(exec).load("https://mcp.x/")).toEqual(creds);
  });

  it("save writes via add-generic-password -U with the JSON as the secret", async () => {
    const exec = vi.fn((_cmd: string, _args: string[]) => Promise.resolve(ok()));
    await new KeychainTokenStore(exec).save("https://mcp.x/", creds);
    const args = exec.mock.calls[0][1];
    expect(args[0]).toBe("add-generic-password");
    expect(args).toContain("-U");
    expect(args).toContain("https://mcp.x/");
    expect(args[args.length - 1]).toBe(JSON.stringify(creds));
  });

  it("save throws on a non-zero exit", async () => {
    const exec: Exec = vi.fn(async () => fail(1, "boom"));
    await expect(new KeychainTokenStore(exec).save("https://mcp.x/", creds)).rejects.toThrow(/keychain save failed/);
  });

  it("clear calls delete-generic-password", async () => {
    const exec = vi.fn((_cmd: string, _args: string[]) => Promise.resolve(ok()));
    await new KeychainTokenStore(exec).clear("https://mcp.x/");
    expect(exec.mock.calls[0][1][0]).toBe("delete-generic-password");
  });
});
