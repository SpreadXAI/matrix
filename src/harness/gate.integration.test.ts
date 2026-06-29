// src/harness/gate.integration.test.ts
import { describe, it, expect, vi } from "vitest";
import { makeWriteGate } from "../core/writeGate.js";

describe("gate enforcement (model-independent)", () => {
  const caps = { follow: 1000, engagement: 500 };
  it("a headless run cannot commit a write without auto-approve", async () => {
    const gate = makeWriteGate({ mode: "headless", caps });
    expect((await gate("mcp__spreadx__create_follow_plan", { username: "x", count: 200, confirmation_token: "ct" })).behavior).toBe("deny");
  });
  it("approval is consulted exactly once per committed write, never on previews", async () => {
    const approve = vi.fn(async () => true);
    const gate = makeWriteGate({ mode: "interactive", caps, approve });
    await gate("mcp__spreadx__create_follow_plan", { username: "x", count: 10 });                          // preview
    await gate("mcp__spreadx__create_follow_plan", { username: "x", count: 10, confirmation_token: "ct" }); // commit
    expect(approve).toHaveBeenCalledTimes(1);
  });
});
