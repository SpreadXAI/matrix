// src/harness/client.ts
import { query, type CanUseTool, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig, type MatrixConfig } from "../core/config.js";
import { makeWriteGate } from "../core/writeGate.js";
import { createMockServer } from "../mock/server.js";

const SYSTEM_APPEND = `You operate a SpreadX account via the mcp__spreadx__* tools.
ALWAYS preview a write tool with confirm:false first, present the shortfall band, and only
call confirm:true after approval. Never bypass the two-step protocol.`;

const ALLOWED = [
  "mcp__spreadx__get_balance", "mcp__spreadx__list_orders", "mcp__spreadx__get_order",
  "mcp__spreadx__get_plan_status", "mcp__spreadx__create_follow_plan", "mcp__spreadx__create_engagement_plan",
];

export async function runAgent(
  prompt: string,
  opts: { config?: MatrixConfig; approve?: (s: string) => Promise<boolean> } = {},
): Promise<string> {
  const config = opts.config ?? loadConfig();
  const gate = makeWriteGate({ mode: config.mode, caps: config.caps, autoApproveWrites: config.autoApproveWrites, approve: opts.approve });

  // Adaptation from brief: CanUseTool requires a 3rd `options` argument; gate ignores it.
  const canUseTool: CanUseTool = (toolName, input, _options) => gate(toolName, input);

  const mcpServers =
    config.mcpUrl === "mock"
      ? { spreadx: createMockServer() }
      : { spreadx: { type: "http" as const, url: config.mcpUrl, ...(config.bearerToken ? { headers: { Authorization: `Bearer ${config.bearerToken}` } } : {}) } };

  let finalText = "";
  for await (const message of query({
    prompt,
    options: {
      model: config.model,
      mcpServers,
      allowedTools: ALLOWED,
      settingSources: ["project"],
      skills: "all",
      systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
      canUseTool,
      maxTurns: 12,
    },
  })) {
    // Adaptation from brief: SDKResultSuccess.result is string (not optional); cast precisely.
    if (message.type === "result" && message.subtype === "success") {
      finalText = (message as SDKResultSuccess).result;
    }
  }
  return finalText;
}
