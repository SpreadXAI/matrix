import { describe, it, expect } from "vitest";
import { balancePayload, followPlanResult, defaultState, toolResult } from "./tools.js";

describe("mock tools", () => {
  it("balance payload", () => {
    expect(balancePayload(defaultState())).toMatchObject({ points: { balance: 1200 }, wallet_balance: 30, package: "pro" });
  });
  it("dry-run preview reports would_select + shortfall AND a confirmation_token", () => {
    const r = followPlanResult({ ...defaultState(), pool: 150 }, { username: "laura", count: 200 }) as any;
    expect(r.dry_run).toBe(true);
    expect(r.operations[0]).toMatchObject({ would_select: 150, shortfall: 50 });
    expect(typeof r.confirmation_token).toBe("string");
  });
  it("commits when shortfall <=10% and a token is present", () => {
    const r = followPlanResult(defaultState(), { username: "laura", count: 200, confirmation_token: "mock-confirm" }) as any;
    expect(r).toMatchObject({ status: "created" });
    expect(typeof r.plan_id).toBe("string");
  });
  it("rejects a commit when shortfall >10%", () => {
    const r = followPlanResult({ ...defaultState(), pool: 100 }, { username: "laura", count: 200, confirmation_token: "mock-confirm" }) as any;
    expect(r).toMatchObject({ error: "shortfall_exceeds_threshold" });
  });
  it("toolResult emits structuredContent AND a text fallback (MCP structured output)", () => {
    const data = balancePayload(defaultState());
    const res = toolResult(data);
    // structuredContent carries the typed object for programmatic consumption…
    expect(res.structuredContent).toEqual(data);
    // …and content[].text carries the same JSON for clients that don't read structuredContent.
    expect(res.content[0]).toEqual({ type: "text", text: JSON.stringify(data) });
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
  });
});
