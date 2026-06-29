import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { balancePayload, followPlanResult, defaultState, toolResult, type MockState } from "./tools.js";

export function createMockServer() {
  const state: MockState = defaultState();
  return createSdkMcpServer({
    name: "spreadx",
    version: "0.1.0",
    tools: [
      tool(
        "get_balance",
        "Get the user's points and wallet balance.",
        {},
        async () => toolResult(balancePayload(state)),
        // Annotations model how the real server should describe this tool. (The gate
        // does NOT trust them — per the MCP spec they're advisory, not a security
        // boundary — but a well-behaved server annotates its tools.)
        { annotations: { readOnlyHint: true, openWorldHint: true } },
      ),
      tool(
        "create_follow_plan",
        "Create a follow growth plan. Call with no confirmation_token to preview (returns a token); pass that token to commit. A commit is rejected if pool shortfall >10%.",
        { username: z.string(), count: z.number().int().positive(), confirmation_token: z.string().optional() },
        async (args) => toolResult(followPlanResult(state, args)),
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
      ),
    ],
  });
}
