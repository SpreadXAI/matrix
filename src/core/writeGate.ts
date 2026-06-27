import { READ_TOOLS, WRITE_TOOLS, isSpreadxTool, specFor } from "./tools.js";

// Re-exported so callers (and the allowedTools regression test) have one import site.
export { READ_TOOLS, WRITE_TOOLS };

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

    // Anything outside this server's namespace (Bash, Read, Write, …) is denied:
    // the harness is a spreadx-only client.
    if (!isSpreadxTool(toolName)) {
      return { behavior: "deny", message: `tool ${toolName} is not a spreadx tool` };
    }

    // A spreadx write tool — either known (in the registry) or unknown (added
    // server-side after this client shipped). Known writes expose a side-effect-free
    // dry-run preview (confirm:false). An UNKNOWN spreadx tool gets no free pass:
    // its semantics are unknown, so it always requires approval — fail SAFE, not
    // fail BROKEN. (Server-supplied readOnly/destructive hints are deliberately not
    // trusted here; the MCP spec treats them as advisory, not a security boundary.)
    const spec = specFor(toolName);
    if (spec && input.confirm !== true) {
      return { behavior: "allow", updatedInput: input };
    }

    // Real write: confirm=true on a known write, or any call to an unknown spreadx tool.
    // Caps apply only to known writes that declare one; they cannot be overridden by approval.
    if (spec?.capKey) {
      const cap = policy.caps[spec.capKey];
      const count = spec.countFrom === "operations" ? engagementTotal(input) : Number(input.count ?? 0);
      if (!Number.isFinite(count) || count < 1 || count > cap) {
        return { behavior: "deny", message: `requested count ${count} is invalid or exceeds cap ${cap}` };
      }
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
