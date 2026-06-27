# SpreadX Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the consumer side of the SpreadX agent capability in this repo — editor wiring (`.mcp.json` + `spreadx-agent` Skill + Codex doc) and a standalone Claude Agent SDK harness with a deterministic write gate — so a Claude/Codex agent can, after one OAuth authorization, call the remote `spreadx-mcp-user` MCP server to read balance/orders and create follow/like plans.

**Architecture:** `spreadx-platform` owns the MCP server (`https://mcp.spreadx.ai/`). This repo owns the clients. Safety on the headless path is a deterministic `canUseTool` gate (human approval + amount caps), never the LLM. A dev-only in-process MCP mock (via the Agent SDK's own `createSdkMcpServer`) lets the harness and Skill run offline until the platform server deploys; cutover is a single env var (`SPREADX_MCP_URL`).

**Tech Stack:** Node 20+, TypeScript (ESM), pnpm, vitest, `@anthropic-ai/claude-agent-sdk`, `zod`. No `@modelcontextprotocol/sdk` (the SDK's in-process server replaces it). No secrets in the repo.

**Spec:** `docs/design/spreadx-matrix.md` (read it first — Global Constraints below are copied from it).

## Global Constraints

- **Tool namespace (verbatim):** `mcp__spreadx__<tool>`, where `<tool>` ∈ `get_balance`, `list_orders`, `get_order`, `get_plan_status`, `create_follow_plan`, `create_engagement_plan`. Scopes (`balance:read`/`orders:read`/`plans:write`) are enforced **server-side**; the client never assumes a scope.
- **Two-step write protocol (server-owned contract):** write tools take `confirm` (default `false`). `confirm=false` ⇒ server returns a dry-run preview; `confirm=true` ⇒ server self-prechecks and **rejects if any op shortfall/requested > 10%**. The client MUST NOT duplicate the shortfall rejection — only the dev mock mirrors it (to emulate the server offline).
- **Safety is deterministic, not LLM-based:** on the headless path the only authorizer of a real write (`confirm=true`) is the harness `canUseTool` gate. The model may propose anything; it can never execute a denied write.
- **Codex path is NOT gated by this repo:** Codex writes are protected only by the server-side guard + Codex's own confirm UI. The `canUseTool` gate exists only in the harness.
- **No secret-at-rest:** editor path uses client-managed OAuth (no token in `.mcp.json`). Harness reads a Bearer token from `SPREADX_ACCESS_TOKEN` only. The SDK itself needs `ANTHROPIC_API_KEY`. Never commit tokens.
- **Shortfall bands (for preview UX / mock only):** `≤5%` ok · `5–10%` tight · `>10%` insufficient. `% = shortfall / requested × 100`.
- **Cross-repo blocker:** real server requires `spreadx-platform` Phase B.4 (FastMCP streamable-http) + deploy. Until then, `SPREADX_MCP_URL=mock` runs the in-process mock.

---

## File Structure

```
spreadx-matrix/
├── package.json · tsconfig.json · vitest.config.ts · .gitignore · .env.example · README.md
├── .mcp.json                                 # Claude Code → remote spreadx (auto-OAuth)
├── .claude/skills/spreadx-agent/SKILL.md     # superpowers skill (UX polish; Claude only)
├── docs/
│   ├── design/spreadx-matrix.md              # spec (already written)
│   ├── codex-setup.md                        # Codex config.toml + login
│   └── superpowers/plans/2026-06-27-spreadx-matrix.md   # this plan
└── src/
    ├── core/
    │   ├── writeGate.ts   + writeGate.test.ts   # canUseTool policy — the safety boundary
    │   └── config.ts      + config.test.ts       # env → MatrixConfig
    ├── mock/
    │   ├── tools.ts       + tools.test.ts        # pure follow-plan decision (shortfall inline)
    │   └── server.ts                             # createSdkMcpServer wrapper (dev-only)
    └── harness/
        ├── client.ts                             # runAgent() via Agent SDK
        ├── cli.ts                                # `matrix "<natural language>"`
        └── gate.integration.test.ts              # model-independent gate enforcement proof
```

Decomposition rationale (post-review trim): `shortfall` is no longer a standalone core module — its only consumer is the mock, so it lives inline there. The mock uses the SDK's in-process server (one small file), dropping the `@modelcontextprotocol/sdk` dependency and a hand-rolled HTTP transport. The CLI is a free-text passthrough (no per-command prompt templating).

---

## Task 1: Scaffold + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `README.md`

**Interfaces:**
- Produces: pnpm scripts `build`/`test`/`harness`; ESM compile to `dist/`; `matrix` bin.

- [ ] **Step 1: `package.json`**

```json
{
  "name": "spreadx-matrix",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "bin": { "matrix": "dist/harness/cli.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "harness": "tsx src/harness/cli.ts"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 4: `.gitignore`**

```gitignore
node_modules/
dist/
.env
.mcp.local.json
*.log
```

- [ ] **Step 5: `.env.example`**

```bash
# Required by the Claude Agent SDK to drive the model
ANTHROPIC_API_KEY=

# Remote MCP server. Use "mock" for the in-process dev mock (no platform needed).
SPREADX_MCP_URL=mock
# Bearer access token for the HARNESS path only (paste a short-lived token; ~15min).
# The editor path (.mcp.json) does its own OAuth and ignores this. Ignored when MCP_URL=mock.
SPREADX_ACCESS_TOKEN=

MATRIX_MODEL=claude-sonnet-4-6
# Headless (1) disables interactive approval; real writes then require MATRIX_AUTO_APPROVE=1
MATRIX_HEADLESS=0
MATRIX_AUTO_APPROVE=0
# Hard caps the gate enforces on real writes (confirm=true)
MATRIX_MAX_FOLLOW=1000
MATRIX_MAX_ENGAGEMENT=500
```

- [ ] **Step 6: `README.md`**

````markdown
# spreadx-matrix

Agent client (Skill + MCP client) for the SpreadX end-user MCP. The MCP **server**
lives in `spreadx-platform`; this repo holds the clients. See `docs/design/spreadx-matrix.md`.

## Editor (Claude Code)
`.mcp.json` mounts `https://mcp.spreadx.ai/`; Claude Code runs the OAuth flow on first tool use.
The `spreadx-agent` skill auto-loads for balance/follow/like asks.

## Editor (Codex)
See `docs/codex-setup.md`.

## Standalone harness
```bash
cp .env.example .env   # set ANTHROPIC_API_KEY; SPREADX_MCP_URL=mock for offline dev
pnpm install
node --env-file=.env --import tsx src/harness/cli.ts "Check my balance"
```
Interactive mode prompts before any real write. Headless (`MATRIX_HEADLESS=1`) needs
`MATRIX_AUTO_APPROVE=1` to commit writes, and still enforces amount caps.
````

- [ ] **Step 7: Install + commit**

```bash
pnpm install
git add package.json tsconfig.json vitest.config.ts .gitignore .env.example README.md pnpm-lock.yaml
git commit -m "chore: scaffold spreadx-matrix (ts + vitest)"
```

---

## Task 2: Write gate (the `canUseTool` safety boundary)

**Files:**
- Create: `src/core/writeGate.ts`, `src/core/writeGate.test.ts`

**Interfaces:**
- Produces:
  - `READ_TOOLS`, `WRITE_TOOLS: Set<string>`.
  - `type GateDecision = { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }` (structurally matches the SDK's `PermissionResult`).
  - `interface WriteGatePolicy { mode: "interactive" | "headless"; caps: { follow: number; engagement: number }; autoApproveWrites?: boolean; approve?: (summary: string) => Promise<boolean> }`.
  - `makeWriteGate(policy): (toolName: string, input: Record<string, unknown>) => Promise<GateDecision>` — wrapped as `canUseTool` in Task 5.
  - `engagementTotal(input): number`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/core/writeGate.test.ts
import { describe, it, expect, vi } from "vitest";
import { makeWriteGate } from "./writeGate.js";

const caps = { follow: 1000, engagement: 500 };

describe("makeWriteGate", () => {
  it("allows read tools", async () => {
    const d = await makeWriteGate({ mode: "interactive", caps })("mcp__spreadx__get_balance", {});
    expect(d.behavior).toBe("allow");
  });
  it("denies tools outside the spreadx allowlist", async () => {
    const d = await makeWriteGate({ mode: "interactive", caps })("Bash", { command: "rm -rf /" });
    expect(d).toMatchObject({ behavior: "deny" });
  });
  it("allows a write in dry-run (confirm falsy) without approval", async () => {
    const approve = vi.fn(async () => false);
    const d = await makeWriteGate({ mode: "interactive", caps, approve })("mcp__spreadx__create_follow_plan", { username: "laura", count: 200 });
    expect(d.behavior).toBe("allow");
    expect(approve).not.toHaveBeenCalled();
  });
  it("interactive confirm=true: granted when approved", async () => {
    const d = await makeWriteGate({ mode: "interactive", caps, approve: async () => true })("mcp__spreadx__create_follow_plan", { username: "laura", count: 200, confirm: true });
    expect(d.behavior).toBe("allow");
  });
  it("interactive confirm=true: denied when declined", async () => {
    const d = await makeWriteGate({ mode: "interactive", caps, approve: async () => false })("mcp__spreadx__create_follow_plan", { username: "laura", count: 200, confirm: true });
    expect(d).toMatchObject({ behavior: "deny" });
  });
  it("denies confirm=true over the follow cap regardless of approval", async () => {
    const d = await makeWriteGate({ mode: "interactive", caps, approve: async () => true })("mcp__spreadx__create_follow_plan", { username: "laura", count: 5000, confirm: true });
    expect(d).toMatchObject({ behavior: "deny" });
  });
  it("sums engagement operations against the engagement cap", async () => {
    const input = { tweet_id: "1", operations: [{ type: "like", count: 300 }, { type: "retweet", count: 300 }], confirm: true };
    const d = await makeWriteGate({ mode: "interactive", caps, approve: async () => true })("mcp__spreadx__create_engagement_plan", input);
    expect(d).toMatchObject({ behavior: "deny" }); // 600 > 500
  });
  it("headless confirm=true: denied without autoApproveWrites", async () => {
    const d = await makeWriteGate({ mode: "headless", caps })("mcp__spreadx__create_follow_plan", { username: "laura", count: 200, confirm: true });
    expect(d).toMatchObject({ behavior: "deny" });
  });
  it("headless confirm=true: allowed with autoApproveWrites under cap", async () => {
    const d = await makeWriteGate({ mode: "headless", caps, autoApproveWrites: true })("mcp__spreadx__create_follow_plan", { username: "laura", count: 200, confirm: true });
    expect(d.behavior).toBe("allow");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/writeGate.test.ts`
Expected: FAIL — `Cannot find module './writeGate.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/writeGate.ts
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
    if (Number.isFinite(count) && count > cap) {
      return { behavior: "deny", message: `requested ${count} exceeds cap ${cap}` };
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/writeGate.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/writeGate.ts src/core/writeGate.test.ts
git commit -m "feat(core): deterministic canUseTool write gate"
```

---

## Task 3: Config loader

**Files:**
- Create: `src/core/config.ts`, `src/core/config.test.ts`

**Interfaces:**
- Consumes: the `caps` shape from Task 2.
- Produces: `interface MatrixConfig { mcpUrl: string; bearerToken?: string; model: string; mode: "interactive" | "headless"; caps: { follow: number; engagement: number }; autoApproveWrites: boolean }` and `loadConfig(env?): MatrixConfig`. `mcpUrl === "mock"` selects the in-process mock.

- [ ] **Step 1: Write the failing test**

```typescript
// src/core/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ mcpUrl: "mock", mode: "interactive", autoApproveWrites: false, caps: { follow: 1000, engagement: 500 } });
  });
  it("reads overrides", () => {
    const c = loadConfig({
      SPREADX_MCP_URL: "https://mcp.spreadx.ai/", SPREADX_ACCESS_TOKEN: "tok",
      MATRIX_HEADLESS: "1", MATRIX_AUTO_APPROVE: "1", MATRIX_MAX_FOLLOW: "50",
      MATRIX_MAX_ENGAGEMENT: "20", MATRIX_MODEL: "claude-opus-4-8",
    });
    expect(c).toMatchObject({
      mcpUrl: "https://mcp.spreadx.ai/", bearerToken: "tok", mode: "headless",
      autoApproveWrites: true, caps: { follow: 50, engagement: 20 }, model: "claude-opus-4-8",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/config.test.ts`
Expected: FAIL — `Cannot find module './config.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/config.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/config.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts src/core/config.test.ts
git commit -m "feat(core): MatrixConfig env loader"
```

---

## Task 4: Editor path — `.mcp.json` + Skill + Codex doc

**Files:**
- Create: `.mcp.json`, `.claude/skills/spreadx-agent/SKILL.md`, `docs/codex-setup.md`

**Interfaces:**
- Produces: a Claude Code MCP mount (auto-OAuth), the auto-discoverable `spreadx-agent` skill, and Codex setup docs. No test cycle (config/markdown) — verified by a frontmatter check.

- [ ] **Step 1: `.mcp.json`**

```json
{
  "mcpServers": {
    "spreadx": {
      "type": "http",
      "url": "https://mcp.spreadx.ai/"
    }
  }
}
```

- [ ] **Step 2: `.claude/skills/spreadx-agent/SKILL.md`**

````markdown
---
name: spreadx-agent
description: Operate a user's SpreadX account through the spreadx MCP tools — check balance and orders, and create follow / like-retweet-comment growth plans. Use when the user asks "how many points/balance do I have", "show my orders", "add N followers to @X", "like/comment/retweet this tweet N times", or to check a plan's progress. Requires the spreadx MCP server connected (one-time OAuth).
---

# SpreadX Agent skill

Turn natural-language asks into `mcp__spreadx__*` tool calls, always previewing writes before committing.

## Tools

| Intent | Tool | Notes |
|---|---|---|
| Balance / points / package | `get_balance` | read-only |
| List orders | `list_orders` | `limit`, `cursor` |
| One order | `get_order` | `order_id` |
| Plan progress | `get_plan_status` | `plan_id` |
| Add followers | `create_follow_plan` | `username`, `count`, `tags?`, `speed?`, `confirm` |
| Engagement (like/retweet/comment) | `create_engagement_plan` | `tweet_url`|`tweet_id`, `operations[{type,count,content_config?}]`, `confirm` |

## Two-step write protocol — ALWAYS

Write tools take `confirm` (default `false`):
1. **Preview** — call with `confirm: false` → server returns dry-run: per-op `pool_size`, `would_select`, `shortfall`, `eta_*`.
2. **Show the numbers + shortfall band, wait for go-ahead**, then call again with `confirm: true`.

Never send `confirm: true` first. The runtime's approval UI (Claude plan mode / harness gate / Codex confirm) is the second gate.

### Shortfall bands

| shortfall vs requested | say | default |
|---|---|---|
| `≤5%` | "pool is sufficient, the gap of X is negligible" | proceed `confirm:true` |
| `5–10%` | "pool is slightly tight, short by X (Y%)" | ask: proceed or lower count? |
| `>10%` | "pool is insufficient — need X, only Y available" | do NOT proceed; server also rejects `confirm:true` |

`%` = `shortfall / requested × 100`.

## Flows
- **Check balance**: `get_balance` → report `points.balance`, `wallet_balance`, `package`.
- **Add 200 crypto English followers to @laura**: `create_follow_plan({username:"laura",count:200,tags:["crypto","en"],confirm:false})` → preview → on approval same call `confirm:true` → report `{plan_id,status}`.
- **Like this tweet 50 times**: `create_engagement_plan({tweet_url:"<url>",operations:[{type:"like",count:50}],confirm:false})` → preview → approval → `confirm:true`.

## Errors
- `401` → re-authorize (client handles redirect). `403` → missing scope / others' plan. `422` → field invalid / pool insufficient. `429` → surface `Retry-After`.
````

- [ ] **Step 3: `docs/codex-setup.md`**

````markdown
# Using the SpreadX MCP server from Codex

Codex is an MCP client and does not use Claude skills — the dry-run/confirm contract
is carried by each write tool's own `description`, so Codex obeys it directly.
Codex writes are protected by the **server-side** shortfall guard + Codex's own confirm UI
(the matrix `canUseTool` gate is harness-only).

## Remote (production)
`~/.codex/config.toml`:
```toml
[mcp_servers.spreadx]
url = "https://mcp.spreadx.ai/"
```
Authorize once: `codex mcp login spreadx`.

> Requires a current Codex CLI with remote streamable-http MCP + OAuth. Older builds
> (stdio-only) should use this repo's harness (`pnpm harness "..."`) instead.
````

- [ ] **Step 4: Verify skill frontmatter**

Run: `head -4 .claude/skills/spreadx-agent/SKILL.md`
Expected: YAML block with `name: spreadx-agent` and a `description:` line.

- [ ] **Step 5: Commit**

```bash
git add .mcp.json .claude/skills/spreadx-agent/SKILL.md docs/codex-setup.md
git commit -m "feat(editor): .mcp.json + spreadx-agent skill + Codex doc"
```

---

## Task 5: Dev mock (in-process SDK MCP server)

**Files:**
- Create: `src/mock/tools.ts`, `src/mock/tools.test.ts`, `src/mock/server.ts`

**Interfaces:**
- Produces:
  - `interface MockState { points: number; wallet: number; pkg: string; pool: number }`, `defaultState(): MockState`.
  - `balancePayload(state): unknown`.
  - `followPlanResult(state, input: { username: string; count: number; confirm?: boolean }): unknown` — dry-run preview when `confirm` falsy; `{ plan_id, status }` on commit; `{ error: "shortfall_exceeds_threshold" }` when `confirm:true` and shortfall>10% (mirrors the server guard; shortfall inline here, no shared module).
  - `createMockServer(): ReturnType<typeof createSdkMcpServer>` — passed as `mcpServers.spreadx` in Task 6.

- [ ] **Step 1: Write the failing test**

```typescript
// src/mock/tools.test.ts
import { describe, it, expect } from "vitest";
import { balancePayload, followPlanResult, defaultState } from "./tools.js";

describe("mock tools", () => {
  it("balance payload", () => {
    expect(balancePayload(defaultState())).toMatchObject({ points: { balance: 1200 }, wallet_balance: 30, package: "pro" });
  });
  it("dry-run preview reports would_select + shortfall", () => {
    const r = followPlanResult({ ...defaultState(), pool: 150 }, { username: "laura", count: 200 }) as any;
    expect(r.dry_run).toBe(true);
    expect(r.operations[0]).toMatchObject({ would_select: 150, shortfall: 50 });
  });
  it("commits when shortfall <=10%", () => {
    const r = followPlanResult(defaultState(), { username: "laura", count: 200, confirm: true }) as any;
    expect(r).toMatchObject({ status: "created" });
    expect(typeof r.plan_id).toBe("string");
  });
  it("rejects confirm=true when shortfall >10%", () => {
    const r = followPlanResult({ ...defaultState(), pool: 100 }, { username: "laura", count: 200, confirm: true }) as any;
    expect(r).toMatchObject({ error: "shortfall_exceeds_threshold" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/mock/tools.test.ts`
Expected: FAIL — `Cannot find module './tools.js'`

- [ ] **Step 3: Write `src/mock/tools.ts`**

```typescript
// src/mock/tools.ts
export interface MockState { points: number; wallet: number; pkg: string; pool: number }

export function defaultState(): MockState {
  return { points: 1200, wallet: 30, pkg: "pro", pool: 1000 };
}

let planSeq = 0;

export function balancePayload(state: MockState): unknown {
  return {
    points: { balance: state.points, total_spent: 0, package_quota: 0 },
    wallet_balance: state.wallet,
    package: state.pkg,
  };
}

export function followPlanResult(
  state: MockState,
  input: { username: string; count: number; confirm?: boolean },
): unknown {
  const wouldSelect = Math.min(input.count, state.pool);
  const shortfall = Math.max(0, input.count - wouldSelect);
  const pct = input.count === 0 ? 0 : (shortfall / input.count) * 100;
  const op = { type: "follow", pool_size: state.pool, would_select: wouldSelect, shortfall, sufficient: pct <= 10 };

  if (!input.confirm) {
    return { dry_run: true, operations: [op], total_requested: input.count, all_sufficient: pct <= 10 };
  }
  if (pct > 10) return { error: "shortfall_exceeds_threshold", operations: [op] };
  planSeq += 1;
  return { plan_id: `mock-plan-${planSeq}`, status: "created" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/mock/tools.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write `src/mock/server.ts`**

```typescript
// src/mock/server.ts
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
```

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm build
git add src/mock/tools.ts src/mock/tools.test.ts src/mock/server.ts
git commit -m "feat(mock): in-process SDK MCP mock (balance + follow plan)"
```

> If `pnpm build` reports the `tool`/`createSdkMcpServer` signature differs from the
> installed `@anthropic-ai/claude-agent-sdk`, adjust to the exported types in
> `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — these are the documented
> in-process-server helpers; the shape above matches the SDK's published example.

---

## Task 6: Harness client + CLI + enforcement proof

**Files:**
- Create: `src/harness/client.ts`, `src/harness/cli.ts`, `src/harness/gate.integration.test.ts`

**Interfaces:**
- Consumes: `loadConfig`/`MatrixConfig` (Task 3), `makeWriteGate` (Task 2), `createMockServer` (Task 5).
- Produces: `runAgent(prompt, opts?): Promise<string>`; the `matrix` CLI; a model-independent test proving the gate blocks denied writes.

- [ ] **Step 1: Write the enforcement test (failing)**

```typescript
// src/harness/gate.integration.test.ts
import { describe, it, expect, vi } from "vitest";
import { makeWriteGate } from "../core/writeGate.js";

describe("gate enforcement (model-independent)", () => {
  const caps = { follow: 1000, engagement: 500 };
  it("a headless run cannot commit a write without auto-approve", async () => {
    const gate = makeWriteGate({ mode: "headless", caps });
    expect((await gate("mcp__spreadx__create_follow_plan", { username: "x", count: 200, confirm: true })).behavior).toBe("deny");
  });
  it("approval is consulted exactly once per confirmed write, never on previews", async () => {
    const approve = vi.fn(async () => true);
    const gate = makeWriteGate({ mode: "interactive", caps, approve });
    await gate("mcp__spreadx__create_follow_plan", { username: "x", count: 10 });        // preview
    await gate("mcp__spreadx__create_follow_plan", { username: "x", count: 10, confirm: true }); // commit
    expect(approve).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/harness/gate.integration.test.ts`
Expected: FAIL — `Cannot find module '../core/writeGate.js'` is already built, so this passes only after Task 2; if Task 2 is done it PASSES immediately. (This test has no production dependency on `client.ts`; it locks the safety contract.)

- [ ] **Step 3: Write `src/harness/client.ts`**

```typescript
// src/harness/client.ts
import { query, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig, type MatrixConfig } from "../core/config.js";
import { makeWriteGate } from "../core/writeGate.js";
import { createMockServer } from "../mock/server.js";

const SYSTEM_APPEND = `You operate a SpreadX account via the mcp__spreadx__* tools.
ALWAYS preview a write tool with confirm:false first, present the shortfall band, and only
call confirm:true after approval. Never bypass the two-step protocol.`;

// Only READ tools are auto-allowed. The two write tools are deliberately
// EXCLUDED: the SDK runs allowedTools without consulting canUseTool, so listing
// a write tool here would bypass the gate. Omitted → they route through
// canUseTool (the write gate), which is the only headless write authorizer.
export const ALLOWED = [
  "mcp__spreadx__get_balance",
  "mcp__spreadx__list_orders",
  "mcp__spreadx__get_order",
  "mcp__spreadx__get_plan_status",
];

export async function runAgent(
  prompt: string,
  opts: { config?: MatrixConfig; approve?: (s: string) => Promise<boolean> } = {},
): Promise<string> {
  const config = opts.config ?? loadConfig();
  const gate = makeWriteGate({ mode: config.mode, caps: config.caps, autoApproveWrites: config.autoApproveWrites, approve: opts.approve });
  const canUseTool: CanUseTool = (toolName, input) => gate(toolName, input as Record<string, unknown>);

  const mcpServers =
    config.mcpUrl === "mock"
      ? { spreadx: createMockServer() }
      : { spreadx: { type: "http" as const, url: config.mcpUrl, headers: config.bearerToken ? { Authorization: `Bearer ${config.bearerToken}` } : {} } };

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
    if (message.type === "result") finalText = (message as { result?: string }).result ?? "";
  }
  return finalText;
}
```

- [ ] **Step 4: Write `src/harness/cli.ts`**

```typescript
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
```

- [ ] **Step 5: Typecheck + full suite**

Run: `pnpm build && pnpm test`
Expected: compiles; all unit + integration tests PASS.

- [ ] **Step 6: Smoke against the mock (requires `ANTHROPIC_API_KEY`)**

Run:
```bash
ANTHROPIC_API_KEY=sk-... SPREADX_MCP_URL=mock node --env-file=.env --import tsx src/harness/cli.ts "Check my balance"
```
Expected: the agent calls `mcp__spreadx__get_balance` and prints points 1200 / wallet 30 / package pro.

- [ ] **Step 7: Commit**

```bash
git add src/harness/client.ts src/harness/cli.ts src/harness/gate.integration.test.ts
git commit -m "feat(harness): Agent SDK client + matrix CLI + gate enforcement test"
```

---

## Self-Review

**Spec coverage** (`docs/design/spreadx-matrix.md`):
- Editor path (config + Skill + Codex) → Task 4. ✓
- Standalone harness (Agent SDK + gate + CLI) → Tasks 2,3,6. ✓
- Dev mock (in-process SDK server) → Task 5. ✓
- balance/follow/like → gate allowlist (T2), skill flows (T4), mock (T5), CLI (T6). ✓
- Auth model (editor auto-OAuth; harness pasted token; ANTHROPIC_API_KEY) → `.mcp.json` (T4), `.env.example`/config (T1,T3). ✓
- Deterministic safety + two-step write → gate (T2) + enforcement proof (T6) + server-guard mirror in mock (T5). ✓

**Anti-over-design checks applied this revision:**
- Dropped `@modelcontextprotocol/sdk` + hand-rolled HTTP mock → SDK in-process server (one file, fewer deps, no fragile transport).
- Removed the standalone `shortfall` core module (no client consumer) → inlined in the mock.
- CLI reduced to a free-text passthrough (no per-command prompt templating).
- Explicitly scoped OUT: OAuth/DCR/PKCE/refresh client (`matrix login` deferred), mocks for the 4 read/engagement tools, production secret management, any duplication of server scope/shortfall authz.

**Gaps filled vs the first draft:** `.gitignore`, `README.md`, `ANTHROPIC_API_KEY` as a required env, `node --env-file` run recipe, harness token-acquisition story stated honestly (paste short-lived token; refresh flow deferred), Codex-path-not-gated-by-this-repo made explicit, mock-coverage limit (balance+follow only; orders/engagement E2E need platform staging) called out.

**Type consistency:** `caps` shape identical across `WriteGatePolicy` (T2), `MatrixConfig` (T3), gate construction (T6). `GateDecision` ≡ SDK `PermissionResult` (allow/deny union). Tool names identical across `writeGate.ts`, `SKILL.md`, mock, and `client.ts` `ALLOWED`. ✓

**Two pre-1.0 external surfaces to confirm at implementation time** (each has a concrete check + fallback, not a placeholder): `tool`/`createSdkMcpServer` signature (T5 Step 6) and the `query` result-message shape / `CanUseTool` import (T6 Step 5) — both against the installed `@anthropic-ai/claude-agent-sdk`.
