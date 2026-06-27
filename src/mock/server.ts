import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { balancePayload, followPlanResult, defaultState, type MockState } from "./tools.js";

export function createMockServer() {
  const state: MockState = defaultState();
  return createSdkMcpServer({
    name: "spreadx",
    version: "0.1.0",
    tools: [
      tool("get_balance", "Get the user's points and wallet balance.", {}, async () => ({
        content: [{ type: "text", text: JSON.stringify(balancePayload(state)) }],
      })),
      tool(
        "create_follow_plan",
        "Create a follow growth plan. confirm=false returns a dry-run preview; confirm=true commits and is rejected if pool shortfall >10%.",
        { username: z.string(), count: z.number().int().positive(), confirm: z.boolean().default(false) },
        async (args) => ({ content: [{ type: "text", text: JSON.stringify(followPlanResult(state, args)) }] }),
      ),
    ],
  });
}
