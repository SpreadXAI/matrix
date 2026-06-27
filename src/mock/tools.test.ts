import { describe, it, expect } from "vitest";
import { balancePayload, followPlanResult, defaultState } from "./tools.js";

describe("mock tools", () => {
  it("balance payload", () => {
    expect(balancePayload(defaultState())).toMatchObject({ points: { balance: 1200 }, wallet_balance: 30, package: "pro" });
  });
  it("dry-run preview reports would_select + shortfall", () => {
    const r = followPlanResult({ ...defaultState(), pool: 150 }, { username: "laura", count: 200 }) as any;
    expect(r.dry_run).toBe(true);
    expect(r.operations[0]).toMatchObject({ would_select: 150, shortfall: 50 });
  });
  it("commits when shortfall <=10%", () => {
    const r = followPlanResult(defaultState(), { username: "laura", count: 200, confirm: true }) as any;
    expect(r).toMatchObject({ status: "created" });
    expect(typeof r.plan_id).toBe("string");
  });
  it("rejects confirm=true when shortfall >10%", () => {
    const r = followPlanResult({ ...defaultState(), pool: 100 }, { username: "laura", count: 200, confirm: true }) as any;
    expect(r).toMatchObject({ error: "shortfall_exceeds_threshold" });
  });
});
