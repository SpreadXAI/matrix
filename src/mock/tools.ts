export interface MockState { points: number; wallet: number; pkg: string; pool: number }

export function defaultState(): MockState {
  return { points: 1200, wallet: 30, pkg: "pro", pool: 1000 };
}

let planSeq = 0;

// ---------------------------------------------------------------------------
// Typed output contracts (the TS equivalent of an MCP `outputSchema`).
// The real server should declare these as `outputSchema` and return matching
// `structuredContent`; the mock returns the same shapes so the harness/skill
// develop against structured output, not free-text JSON.
// ---------------------------------------------------------------------------

export interface BalanceOutput {
  points: { balance: number; total_spent: number; package_quota: number };
  wallet_balance: number;
  package: string;
}

export interface FollowOp {
  type: "follow";
  pool_size: number;
  would_select: number;
  shortfall: number;
  sufficient: boolean;
}

export type FollowPlanOutput =
  | { dry_run: true; operations: FollowOp[]; total_requested: number; all_sufficient: boolean; confirmation_token: string }
  | { plan_id: string; status: "created" }
  | { error: "shortfall_exceeds_threshold"; operations: FollowOp[] };

export function balancePayload(state: MockState): BalanceOutput {
  return {
    points: { balance: state.points, total_spent: 0, package_quota: 0 },
    wallet_balance: state.wallet,
    package: state.pkg,
  };
}

export function followPlanResult(
  state: MockState,
  input: { username: string; count: number; confirmation_token?: string },
): FollowPlanOutput {
  const wouldSelect = Math.min(input.count, state.pool);
  const shortfall = Math.max(0, input.count - wouldSelect);
  const pct = input.count === 0 ? 0 : (shortfall / input.count) * 100;
  const op: FollowOp = { type: "follow", pool_size: state.pool, would_select: wouldSelect, shortfall, sufficient: pct <= 10 };

  // No token → preview. Hand back a deterministic mock token to thread back on commit.
  // The mock does NOT verify the token (that is the real server's job).
  if (!input.confirmation_token) {
    return { dry_run: true, operations: [op], total_requested: input.count, all_sufficient: pct <= 10, confirmation_token: "mock-confirm" };
  }
  // Token present → commit. Keep mirroring the server's shortfall>10% reject offline.
  if (pct > 10) return { error: "shortfall_exceeds_threshold", operations: [op] };
  planSeq += 1;
  return { plan_id: `mock-plan-${planSeq}`, status: "created" };
}

// MCP structured tool output (spec 2025-06-18, STABLE): return BOTH the
// structured object (`structuredContent`, for programmatic consumption / schema
// validation) AND the serialized JSON in a text block (backward-compatible
// fallback for clients that don't read structuredContent).
export function toolResult(data: unknown): {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}
