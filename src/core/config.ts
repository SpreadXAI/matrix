export interface MatrixConfig {
  mcpUrl: string;
  bearerToken?: string;
  model: string;
  mode: "interactive" | "headless";
  caps: { follow: number; engagement: number };
  autoApproveWrites: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MatrixConfig {
  return {
    mcpUrl: env.SPREADX_MCP_URL ?? "mock",
    bearerToken: env.SPREADX_ACCESS_TOKEN || undefined,
    model: env.MATRIX_MODEL ?? "claude-sonnet-4-6",
    mode: env.MATRIX_HEADLESS === "1" ? "headless" : "interactive",
    caps: {
      follow: Number(env.MATRIX_MAX_FOLLOW ?? 1000),
      engagement: Number(env.MATRIX_MAX_ENGAGEMENT ?? 500),
    },
    autoApproveWrites: env.MATRIX_AUTO_APPROVE === "1",
  };
}
