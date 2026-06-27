// src/harness/client.ts
import { query, type CanUseTool, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig, type MatrixConfig } from "../core/config.js";
import { makeWriteGate } from "../core/writeGate.js";
import { ALLOWED_READ } from "../core/tools.js";
import { createMockServer } from "../mock/server.js";
import { resolveAccessToken } from "../auth/resolve.js";
import { defaultTokenStore } from "../auth/store.js";
import type { TokenStore } from "../auth/tokenStore.js";

const SYSTEM_APPEND = `You operate a SpreadX account via the mcp__spreadx__* tools.
ALWAYS preview a write tool with confirm:false first, present the shortfall band, and only
call confirm:true after approval. Never bypass the two-step protocol.`;

// Only READ tools are auto-allowed (derived from the tool registry). Write tools — and
// any unknown spreadx tool — are deliberately EXCLUDED: the SDK runs allowedTools without
// consulting canUseTool, so listing one here would bypass the gate. Omitted → they route
// through canUseTool (the write gate), the only headless write authorizer.
export const ALLOWED = ALLOWED_READ;

export async function runAgent(
  prompt: string,
  opts: { config?: MatrixConfig; approve?: (s: string) => Promise<boolean>; store?: TokenStore } = {},
): Promise<string> {
  const config = opts.config ?? loadConfig();
  const gate = makeWriteGate({ mode: config.mode, caps: config.caps, autoApproveWrites: config.autoApproveWrites, approve: opts.approve });

  // Adaptation from brief: CanUseTool requires a 3rd `options` argument; gate ignores it.
  const canUseTool: CanUseTool = (toolName, input, _options) => gate(toolName, input);

  // env token → stored credentials (refreshed) → "run matrix login"; mock needs none.
  const accessToken = await resolveAccessToken(config, { store: opts.store ?? defaultTokenStore() });

  const mcpServers =
    config.mcpUrl === "mock"
      ? { spreadx: createMockServer() }
      : { spreadx: { type: "http" as const, url: config.mcpUrl, ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}) } };

  let finalText: string | null = null;
  let failureSubtype: string | null = null;
  for await (const message of query({
    prompt,
    options: {
      model: config.model,
      mcpServers,
      allowedTools: [...ALLOWED],
      settingSources: ["project"],
      skills: "all",
      systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
      canUseTool,
      maxTurns: 12,
    },
  })) {
    if (message.type === "result") {
      // Adaptation from brief: SDKResultSuccess.result is string (not optional); cast precisely.
      if (message.subtype === "success") finalText = (message as SDKResultSuccess).result;
      else failureSubtype = message.subtype;
    }
  }
  if (finalText === null) {
    throw new Error(`agent run did not succeed: ${failureSubtype ?? "no result message"}`);
  }
  return finalText;
}
