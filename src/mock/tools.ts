export interface MockState { points: number; wallet: number; pkg: string; pool: number }

export function defaultState(): MockState {
  return { points: 1200, wallet: 30, pkg: "pro", pool: 1000 };
}

let planSeq = 0;

export function balancePayload(state: MockState): unknown {
  return {
    points: { balance: state.points, total_spent: 0, package_quota: 0 },
    wallet_balance: state.wallet,
    package: state.pkg,
  };
}

export function followPlanResult(
  state: MockState,
  input: { username: string; count: number; confirm?: boolean },
): unknown {
  const wouldSelect = Math.min(input.count, state.pool);
  const shortfall = Math.max(0, input.count - wouldSelect);
  const pct = input.count === 0 ? 0 : (shortfall / input.count) * 100;
  const op = { type: "follow", pool_size: state.pool, would_select: wouldSelect, shortfall, sufficient: pct <= 10 };

  if (!input.confirm) {
    return { dry_run: true, operations: [op], total_requested: input.count, all_sufficient: pct <= 10 };
  }
  if (pct > 10) return { error: "shortfall_exceeds_threshold", operations: [op] };
  planSeq += 1;
  return { plan_id: `mock-plan-${planSeq}`, status: "created" };
}
