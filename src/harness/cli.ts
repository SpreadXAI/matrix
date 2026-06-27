// src/harness/cli.ts
import { createInterface } from "node:readline/promises";
import { runAgent } from "./client.js";
import { loadConfig } from "../core/config.js";

async function confirmStdin(summary: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(`\n⚠️  Approve write?\n${summary}\n[y/N] `)).trim().toLowerCase();
  rl.close();
  return ans === "y" || ans === "yes";
}

async function main() {
  const argv = process.argv.slice(2);
  const config = loadConfig();

  if (argv[0] === "login") {
    if (config.mcpUrl === "mock") {
      throw new Error("login is not needed for the mock; set SPREADX_MCP_URL to the real server first");
    }
    const { login } = await import("../auth/login.js");
    await login(config.mcpUrl);
    // eslint-disable-next-line no-console
    console.log(`Logged in to ${config.mcpUrl}. Credentials saved; future runs refresh the token automatically.`);
    return;
  }

  if (argv[0] === "logout") {
    const { defaultTokenStore } = await import("../auth/store.js");
    await defaultTokenStore().clear(config.mcpUrl);
    // eslint-disable-next-line no-console
    console.log(`Logged out of ${config.mcpUrl}.`);
    return;
  }

  const prompt = argv.join(" ").trim();
  if (!prompt) throw new Error('usage: matrix "<instruction>"  |  matrix login  |  matrix logout');
  const result = await runAgent(prompt, { config, approve: config.mode === "interactive" ? confirmStdin : undefined });
  // eslint-disable-next-line no-console
  console.log(result);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
