# spreadx-matrix — installation & usage

This is the in-depth guide. For the overview, see the [README](../README.md).

There are two independent ways to use spreadx-matrix. Pick one (or both):

1. **Editor path** — mount the MCP server inside Claude Code or Codex; use it conversationally.
2. **Standalone harness** — a `matrix` CLI that drives the agent programmatically (scripts, batch, headless).

Both talk to the same MCP server and obey the same write protocol.

---

## Prerequisites

| | Editor path | Harness path |
|---|---|---|
| Claude Code **or** Codex CLI (recent build, remote MCP support) | ✅ | — |
| Node ≥ 20 + `pnpm` | — | ✅ |
| `ANTHROPIC_API_KEY` (the Agent SDK drives the model) | — | ✅ |
| A SpreadX access token (`SPREADX_ACCESS_TOKEN`) | handled by browser OAuth | needed for the **real** server; not for the mock |

> **Today you can run everything offline against the built-in mock** (`SPREADX_MCP_URL=mock`) — no platform, no token. The real server (`mcp.spreadx.ai`) becomes reachable once `spreadx-platform` ships Phase B.4 and deploys.

---

## Install — Editor path

### Claude Code — plugin (recommended)

Install the plugin; it registers the `spreadx` MCP server **and** the `spreadx-agent` Skill in one step:

```
/plugin marketplace add SpreadXAI/spreadx-marketplace
/plugin install spreadx-matrix@spreadx-marketplace
```

Then on the first tool call Claude Code performs the OAuth flow — a browser window opens, you log in (via Privy) and approve the requested scopes **once**. The refresh token is held by the authorization server; you won't log in again.

Update / remove later with:
```
/plugin marketplace update spreadx-marketplace
/plugin uninstall spreadx-matrix
```

### Claude Code — without the plugin

If you'd rather not use the plugin (e.g. you cloned this repo to work on it), the repo already contains [`.mcp.json`](../.mcp.json):

```json
{ "mcpServers": { "spreadx": { "type": "http", "url": "https://mcp.spreadx.ai/" } } }
```

Open the repo in Claude Code (it auto-mounts), or register the server anywhere with:
```bash
claude mcp add --transport http spreadx https://mcp.spreadx.ai/
```
The **`spreadx-agent`** Skill auto-loads from `.claude/skills/` when your request looks like balance / orders / follow / like.

**Local dev against the mock:** the editor path needs a live HTTP server; the mock is in-process to the harness. For an offline loop today, use the harness below with `SPREADX_MCP_URL=mock`.

### Codex

Codex is an MCP client with no Skill system — the dry-run/confirm contract is carried by each tool's own `description`, so Codex follows it directly. **Codex writes are gated by the server-side guard + Codex's own confirm UI, not by this repo's `canUseTool` gate** (that's harness-only).

Add to `~/.codex/config.toml`:
```toml
[mcp_servers.spreadx]
url = "https://mcp.spreadx.ai/"
```
Then `codex mcp login spreadx`. Full notes: [`docs/codex-setup.md`](codex-setup.md).

---

## Install — Standalone harness

```bash
pnpm install
cp .env.example .env
```

Edit `.env`:

| Var | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Required.** The Claude Agent SDK uses it to drive the model. |
| `SPREADX_MCP_URL` | `mock` | `mock` = in-process dev mock; otherwise the server URL (e.g. `https://mcp.spreadx.ai/`). |
| `SPREADX_ACCESS_TOKEN` | — | Bearer token for the **real** server (paste a short-lived one). Ignored when URL is `mock`. |
| `MATRIX_MODEL` | `claude-sonnet-4-6` | Model the harness drives. |
| `MATRIX_HEADLESS` | `0` | `1` disables interactive approval prompts. |
| `MATRIX_AUTO_APPROVE` | `0` | `1` lets headless mode commit writes (still capped). |
| `MATRIX_MAX_FOLLOW` | `1000` | Hard cap the gate enforces on a real follow write. |
| `MATRIX_MAX_ENGAGEMENT` | `500` | Hard cap on a real engagement write (summed over ops). |

Run (no build needed — `tsx` runs the TypeScript directly):

```bash
node --env-file=.env --import tsx src/harness/cli.ts "查一下我的余额"
# or, with env already exported:
pnpm harness "查一下我的余额"
```

Install the `matrix` command globally (optional):
```bash
pnpm build && pnpm link --global   # then: matrix "查余额"
```

---

## Usage

The CLI takes one free-text instruction; the agent picks the right tool.

### Read balance / orders

```bash
matrix "查一下我的余额和套餐"
matrix "列出我最近的充值订单"
matrix "plan 7f3a… 现在涨了多少粉了?"
```

### Add followers (a write — previewed first)

```bash
matrix "帮 @laura 加 200 个 crypto 英文粉"
```
The agent calls `create_follow_plan(confirm:false)` → shows the pool size, would-select, shortfall band → asks you to confirm → on approval calls `confirm:true`. In **interactive** mode you get a `y/N` prompt before the real write:

```
⚠️  Approve write?
mcp__spreadx__create_follow_plan {"username":"laura","count":200,"confirm":true}
[y/N]
```

### Engagement: like / retweet / comment (a write)

```bash
matrix "给这条推 https://x.com/x/status/123 点 50 个赞"
```

### Headless / batch

```bash
MATRIX_HEADLESS=1 MATRIX_AUTO_APPROVE=1 MATRIX_MAX_FOLLOW=300 \
  matrix "帮 @laura 加 200 个粉"
```
Headless suppresses prompts. A real write then needs `MATRIX_AUTO_APPROVE=1` **and** must be within the cap, or the gate denies it. Reads and previews always run.

---

## How the write gate decides (harness)

The gate is `src/core/writeGate.ts`, wired as the SDK's `canUseTool`:

```
tool call
 ├─ read tool (get_balance/list_orders/get_order/get_plan_status) ─────────────▶ ALLOW
 ├─ not an mcp__spreadx__* tool ───────────────────────────────────────────────▶ DENY
 └─ write tool (create_follow_plan / create_engagement_plan)
      ├─ confirm ≠ true  (preview) ───────────────────────────────────────────▶ ALLOW  (no side effects)
      └─ confirm = true  (real write)
           ├─ count invalid / < 1 / > cap ──────────────────────────────────▶ DENY   (fail closed)
           ├─ headless: MATRIX_AUTO_APPROVE=1 ? ──────────────────── ALLOW : DENY
           └─ interactive: stdin y/N ─────────────────────────────── ALLOW : DENY
```

The model cannot route around this — write tools are excluded from the SDK's `allowedTools`, so they always reach the gate. This is verified by `src/harness/allowedTools.test.ts` and `src/harness/gate.integration.test.ts` (model-independent).

---

## The dev mock

`SPREADX_MCP_URL=mock` swaps the remote server for an in-process MCP server (`src/mock/server.ts`) so you can develop and demo offline.

- **Implements:** `get_balance` and `create_follow_plan` (incl. the dry-run preview and the server's `shortfall > 10% ⇒ reject confirm:true` guard).
- **Does not implement:** `list_orders`, `get_order`, `get_plan_status`, `create_engagement_plan`. Asking for orders or a like against the mock will fail — verify those against platform staging.
- It's **dev-only** and throwaway once the real server is deployed.

---

## Cutover to the real server

When `spreadx-platform` deploys `mcp.spreadx.ai`:

- **Editor:** nothing to change — `.mcp.json` already points there; first use triggers OAuth.
- **Harness:** set `SPREADX_MCP_URL=https://mcp.spreadx.ai/` and `SPREADX_ACCESS_TOKEN=<token>`. No code change.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `SPREADX_ACCESS_TOKEN is required when SPREADX_MCP_URL is not 'mock'` | Set a token, or use `SPREADX_MCP_URL=mock` for offline dev. |
| `agent run did not succeed: …` | The model run ended in error (`error_max_turns`, auth, network). The subtype tells you which; check `ANTHROPIC_API_KEY` and the MCP URL. |
| `401` / re-authorize | The OAuth session lapsed. Editor: re-run the browser flow. Harness: paste a fresh `SPREADX_ACCESS_TOKEN`. |
| `403` | Missing scope (`plans:write` for writes) or someone else's plan. |
| Tool-not-found against the mock | The mock only implements `get_balance` + `create_follow_plan`. Use the real server (or staging) for the rest. |
| `usage: matrix "<natural language instruction>"` | You ran `matrix` with no prompt — pass one quoted argument. |
| Empty output, exit 1 | A failed run now throws instead of printing nothing — read the error line above it. |

---

## Reference

- [README](../README.md) — overview & architecture
- [`docs/design/spreadx-matrix.md`](design/spreadx-matrix.md) — design spec
- [`docs/codex-setup.md`](codex-setup.md) — Codex setup
- `spreadx-platform` — the MCP server, OAuth AS, and tool contracts
