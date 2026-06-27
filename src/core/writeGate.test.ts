import { describe, it, expect, vi } from "vitest";
import { makeWriteGate } from "./writeGate.js";

const caps = { follow: 1000, engagement: 500 };

describe("makeWriteGate", () => {
  it("allows read tools", async () => {
    const d = await makeWriteGate({ mode: "interactive", caps })("mcp__spreadx__get_balance", {});
    expect(d.behavior).toBe("allow");
  });
  it("denies tools outside the spreadx allowlist", async () => {
    const d = await makeWriteGate({ mode: "interactive", caps })("Bash", { command: "rm -rf /" });
    expect(d).toMatchObject({ behavior: "deny" });
  });
  it("allows a write in dry-run (confirm falsy) without approval", async () => {
    const approve = vi.fn(async () => false);
    const d = await makeWriteGate({ mode: "interactive", caps, approve })("mcp__spreadx__create_follow_plan", { username: "laura", count: 200 });
    expect(d.behavior).toBe("allow");
    expect(approve).not.toHaveBeenCalled();
  });
  it("interactive confirm=true: granted when approved", async () => {
    const d = await makeWriteGate({ mode: "interactive", caps, approve: async () => true })("mcp__spreadx__create_follow_plan", { username: "laura", count: 200, confirm: true });
    expect(d.behavior).toBe("allow");
  });
  it("interactive confirm=true: denied when declined", async () => {
    const d = await makeWriteGate({ mode: "interactive", caps, approve: async () => false })("mcp__spreadx__create_follow_plan", { username: "laura", count: 200, confirm: true });
    expect(d).toMatchObject({ behavior: "deny" });
  });
  it("denies confirm=true over the follow cap regardless of approval", async () => {
    const d = await makeWriteGate({ mode: "interactive", caps, approve: async () => true })("mcp__spreadx__create_follow_plan", { username: "laura", count: 5000, confirm: true });
    expect(d).toMatchObject({ behavior: "deny" });
  });
  it("sums engagement operations against the engagement cap", async () => {
    const input = { tweet_id: "1", operations: [{ type: "like", count: 300 }, { type: "retweet", count: 300 }], confirm: true };
    const d = await makeWriteGate({ mode: "interactive", caps, approve: async () => true })("mcp__spreadx__create_engagement_plan", input);
    expect(d).toMatchObject({ behavior: "deny" }); // 600 > 500
  });
  it("headless confirm=true: denied without autoApproveWrites", async () => {
    const d = await makeWriteGate({ mode: "headless", caps })("mcp__spreadx__create_follow_plan", { username: "laura", count: 200, confirm: true });
    expect(d).toMatchObject({ behavior: "deny" });
  });
  it("headless confirm=true: allowed with autoApproveWrites under cap", async () => {
    const d = await makeWriteGate({ mode: "headless", caps, autoApproveWrites: true })("mcp__spreadx__create_follow_plan", { username: "laura", count: 200, confirm: true });
    expect(d.behavior).toBe("allow");
  });
  it("denies confirm=true when count is non-numeric (fail closed)", async () => {
    const d = await makeWriteGate({ mode: "interactive", caps, approve: async () => true })("mcp__spreadx__create_follow_plan", { username: "laura", count: "abc" as unknown as number, confirm: true });
    expect(d).toMatchObject({ behavior: "deny" });
  });
  it("denies confirm=true when count is zero or negative (fail closed)", async () => {
    const gate = makeWriteGate({ mode: "interactive", caps, approve: async () => true });
    expect((await gate("mcp__spreadx__create_follow_plan", { username: "x", count: 0, confirm: true })).behavior).toBe("deny");
    expect((await gate("mcp__spreadx__create_follow_plan", { username: "x", count: -5, confirm: true })).behavior).toBe("deny");
  });
  it("treats an UNKNOWN spreadx tool as a write — never a free preview (fail safe)", async () => {
    // An unknown spreadx.* tool (e.g. added server-side later) must require approval
    // even with confirm:false — no side-effect-free assumption.
    const declined = makeWriteGate({ mode: "interactive", caps, approve: async () => false });
    expect((await declined("mcp__spreadx__delete_account", { confirm: false })).behavior).toBe("deny");

    const granted = makeWriteGate({ mode: "interactive", caps, approve: async () => true });
    expect((await granted("mcp__spreadx__delete_account", { confirm: true })).behavior).toBe("allow");

    // headless without auto-approve denies it
    expect((await makeWriteGate({ mode: "headless", caps })("mcp__spreadx__delete_account", {})).behavior).toBe("deny");
  });
});
