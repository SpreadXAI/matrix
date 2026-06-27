import { describe, it, expect } from "vitest";
import { runAgent } from "./client.js";
import type { MatrixConfig } from "../core/config.js";
import type { TokenStore } from "../auth/tokenStore.js";

const remoteNoToken: MatrixConfig = {
  mcpUrl: "https://mcp.spreadx.ai/", bearerToken: undefined, model: "claude-sonnet-4-6",
  mode: "headless", caps: { follow: 1000, engagement: 500 }, autoApproveWrites: false,
};

// Empty store (no saved credentials) — keeps the test hermetic regardless of any
// real ~/.config/spreadx-matrix/credentials.json on the machine.
const emptyStore: TokenStore = { load: async () => null, save: async () => {}, clear: async () => {} };

describe("runAgent remote-path token resolution", () => {
  it("throws a 'matrix login' hint when a non-mock URL has no env token and no stored credentials (before contacting the model)", async () => {
    await expect(runAgent("Check my balance", { config: remoteNoToken, store: emptyStore })).rejects.toThrow(/matrix login/);
  });
});
