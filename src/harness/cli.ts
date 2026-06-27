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
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) throw new Error('usage: matrix "<natural language instruction>"');
  const config = loadConfig();
  const result = await runAgent(prompt, { config, approve: config.mode === "interactive" ? confirmStdin : undefined });
  // eslint-disable-next-line no-console
  console.log(result);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
