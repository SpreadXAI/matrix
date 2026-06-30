// Single source of truth for the spreadx MCP tools. The write gate, the harness
// allowedTools, and the dev mock all derive from this — adding or renaming a tool
// happens in exactly one place, so the three can never drift.

export const SERVER = "spreadx";
export const NS = `mcp__${SERVER}__`;

export type ToolKind = "read" | "write";

export interface ToolSpec {
  /** Bare tool name as the server exposes it, e.g. "get_balance". */
  name: string;
  kind: ToolKind;
  /** For writes that carry an amount the gate caps. */
  capKey?: "follow" | "engagement";
  /** How the amount is read from the tool input. */
  countFrom?: "count" | "operations";
}

export const TOOLS: readonly ToolSpec[] = [
  { name: "get_balance", kind: "read" },
  { name: "list_orders", kind: "read" },
  { name: "get_order", kind: "read" },
  { name: "list_plans", kind: "read" },
  { name: "get_plan", kind: "read" },
  { name: "estimate_follow_cost", kind: "read" },
  { name: "create_follow_plan", kind: "write", capKey: "follow", countFrom: "count" },
  { name: "create_engagement_plan", kind: "write", capKey: "engagement", countFrom: "operations" },
];

/** Fully-qualified tool name as the model/SDK sees it. */
export const qualified = (name: string): string => `${NS}${name}`;

/** True for any tool in this server's namespace (known or not — used for fail-safe gating). */
export const isSpreadxTool = (toolName: string): boolean => toolName.startsWith(NS);

export const READ_TOOLS: ReadonlySet<string> = new Set(
  TOOLS.filter((t) => t.kind === "read").map((t) => qualified(t.name)),
);
export const WRITE_TOOLS: ReadonlySet<string> = new Set(
  TOOLS.filter((t) => t.kind === "write").map((t) => qualified(t.name)),
);

/** Read tools the harness auto-allows (everything else routes through the gate). */
export const ALLOWED_READ: readonly string[] = [...READ_TOOLS];

const BY_QUALIFIED = new Map(TOOLS.map((t) => [qualified(t.name), t]));
export const specFor = (toolName: string): ToolSpec | undefined => BY_QUALIFIED.get(toolName);
