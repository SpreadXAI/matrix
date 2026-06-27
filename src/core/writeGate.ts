export const READ_TOOLS = new Set([
  "mcp__spreadx__get_balance",
  "mcp__spreadx__list_orders",
  "mcp__spreadx__get_order",
  "mcp__spreadx__get_plan_status",
]);

export const WRITE_TOOLS = new Set([
  "mcp__spreadx__create_follow_plan",
  "mcp__spreadx__create_engagement_plan",
]);

export type GateDecision =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export interface WriteGatePolicy {
  mode: "interactive" | "headless";
  caps: { follow: number; engagement: number };
  autoApproveWrites?: boolean;
  approve?: (summary: string) => Promise<boolean>;
}

export function engagementTotal(input: Record<string, unknown>): number {
  const ops = Array.isArray(input.operations) ? input.operations : [];
  return ops.reduce((sum, op) => sum + Number((op as { count?: number }).count ?? 0), 0);
}

export function makeWriteGate(policy: WriteGatePolicy) {
  return async function canUseTool(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<GateDecision> {
    if (READ_TOOLS.has(toolName)) return { behavior: "allow", updatedInput: input };
    if (!WRITE_TOOLS.has(toolName)) {
      return { behavior: "deny", message: `tool ${toolName} is not in the spreadx allowlist` };
    }
    // Preview (confirm falsy) never mutates state — allow so the model can fetch the dry-run.
    if (input.confirm !== true) return { behavior: "allow", updatedInput: input };

    // confirm=true => real write. Caps first; they cannot be overridden by approval.
    const isFollow = toolName === "mcp__spreadx__create_follow_plan";
    const cap = isFollow ? policy.caps.follow : policy.caps.engagement;
    const count = isFollow ? Number(input.count ?? 0) : engagementTotal(input);
    if (!Number.isFinite(count) || count > cap) {
      return { behavior: "deny", message: `requested count ${count} is invalid or exceeds cap ${cap}` };
    }
    if (policy.mode === "headless") {
      return policy.autoApproveWrites
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: "headless: real writes require MATRIX_AUTO_APPROVE=1" };
    }
    const ok = policy.approve ? await policy.approve(`${toolName} ${JSON.stringify(input)}`) : false;
    return ok ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "user declined the write" };
  };
}
