import { describe, it, expect } from "vitest";
import { balancePayload, followPlanResult, estimateFollowCostResult, defaultState, toolResult, MOCK_CONFIRMATION_TOKEN } from "./tools.js";

describe("mock tools", () => {
  it("balance payload", () => {
    expect(balancePayload(defaultState())).toMatchObject({ points: { balance: 1200 }, wallet_balance: 30, package: "pro" });
  });
  it("dry-run preview reports would_select + shortfall AND a confirmation_token", () => {
    const r = followPlanResult({ ...defaultState(), pool: 150 }, { username: "laura", count: 200 }) as any;
    expect(r.dry_run).toBe(true);
    expect(r.operations[0]).toMatchObject({ would_select: 150, shortfall: 50 });
    expect(r.confirmation_token).toBe(MOCK_CONFIRMATION_TOKEN);
  });
  it("commits when shortfall <=10% and the preview token is threaded back", () => {
    const preview = followPlanResult(defaultState(), { username: "laura", count: 200 }) as any;
    const r = followPlanResult(defaultState(), { username: "laura", count: 200, confirmation_token: preview.confirmation_token }) as any;
    expect(r).toMatchObject({ status: "created" });
    expect(typeof r.plan_id).toBe("string");
  });
  it("rejects a commit when shortfall >10%", () => {
    const r = followPlanResult({ ...defaultState(), pool: 100 }, { username: "laura", count: 200, confirmation_token: MOCK_CONFIRMATION_TOKEN }) as any;
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
  it("estimate prices all three speeds, scaling with count and differing by speed", () => {
    const r = estimateFollowCostResult(defaultState(), { count: 200 });
    expect(r.count).toBe(200);
    expect(Object.keys(r.presets).sort()).toEqual(["boost", "standard", "turbo"]);
    // Per-speed costs are integers and genuinely differ (standard < boost < turbo).
    expect(r.presets.standard).toBeLessThan(r.presets.boost);
    expect(r.presets.boost).toBeLessThan(r.presets.turbo);
    for (const v of Object.values(r.presets)) expect(Number.isInteger(v)).toBe(true);
    // Deterministic + scales with count.
    expect(estimateFollowCostResult(defaultState(), { count: 200 })).toEqual(r);
    expect(estimateFollowCostResult(defaultState(), { count: 400 }).presets.standard).toBe(r.presets.standard * 2);
  });
});
