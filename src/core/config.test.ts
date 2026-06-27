import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ mcpUrl: "mock", mode: "interactive", autoApproveWrites: false, caps: { follow: 1000, engagement: 500 }, model: "claude-sonnet-4-6" });
  });
  it("reads overrides", () => {
    const c = loadConfig({
      SPREADX_MCP_URL: "https://mcp.spreadx.ai/", SPREADX_ACCESS_TOKEN: "tok",
      MATRIX_HEADLESS: "1", MATRIX_AUTO_APPROVE: "1", MATRIX_MAX_FOLLOW: "50",
      MATRIX_MAX_ENGAGEMENT: "20", MATRIX_MODEL: "claude-opus-4-8",
    });
    expect(c).toMatchObject({
      mcpUrl: "https://mcp.spreadx.ai/", bearerToken: "tok", mode: "headless",
      autoApproveWrites: true, caps: { follow: 50, engagement: 20 }, model: "claude-opus-4-8",
    });
  });
  it("treats empty SPREADX_ACCESS_TOKEN as undefined", () => {
    const c = loadConfig({ SPREADX_ACCESS_TOKEN: "" });
    expect(c.bearerToken).toBeUndefined();
  });
});
