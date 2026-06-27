import { describe, it, expect } from "vitest";
import { runAgent } from "./client.js";
import type { MatrixConfig } from "../core/config.js";

const remoteNoToken: MatrixConfig = {
  mcpUrl: "https://mcp.spreadx.ai/", bearerToken: undefined, model: "claude-sonnet-4-6",
  mode: "headless", caps: { follow: 1000, engagement: 500 }, autoApproveWrites: false,
};

describe("runAgent remote-path guard", () => {
  it("throws when a non-mock URL has no bearer token (before contacting the model)", async () => {
    await expect(runAgent("查余额", { config: remoteNoToken })).rejects.toThrow(/SPREADX_ACCESS_TOKEN/);
  });
});
