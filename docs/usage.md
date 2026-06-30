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
/plugin marketplace add SpreadXAI/matrix
/plugin install spreadx-matrix@spreadx-marketplace
```

Then on the first tool call Claude Code performs the OAuth flow — a browser window opens, you log in (via Privy) and approve the requested scopes **once**. The refresh token is held by the authorization server; you won't log in again.

Update / remove later with:
```
/plugin marketplace update spreadx-marketplace
/plugin uninstall spreadx-matrix
```

> **Name vs source.** You **add** by repo source — `SpreadXAI/matrix` — but **install /
> update / uninstall** by the names declared inside the manifest: the plugin is
> `spreadx-matrix` and the marketplace it belongs to is `spreadx-marketplace` (both set in
> [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json)). That's why the
> repo path and the `@spreadx-marketplace` suffix differ — `add` needs a place to fetch
> from, the rest reference the local name. There is no central registry, so
> `add spreadx-marketplace` (a bare name) won't resolve.

### Claude Code — without the plugin

If you'd rather not use the plugin (e.g. you cloned this repo to work on it), the repo already contains [`.mcp.json`](../.mcp.json):

```json
{ "mcpServers": { "spreadx": { "type": "http", "url": "https://mcp.spreadx.ai/" } } }
```

Open the repo in Claude Code (it auto-mounts), or register the server anywhere with:
```bash
claude mcp add --transport http spreadx https://mcp.spreadx.ai/
```
The **`spreadx-agent`** Skill auto-loads when your request looks like balance / orders / follow / like (it lives in `skills/`, surfaced at `.claude/skills/` via a symlink for project use).

**Local dev against the mock:** the editor path needs a live HTTP server; the mock is in-process to the harness. For an offline loop today, use the harness below with `SPREADX_MCP_URL=mock`.

### Codex

Codex is an MCP client and loads skills natively, but the dry-run/confirm contract is carried by each tool's own `description`, so it holds with or without the skill. **Codex writes are gated by the server-side guard + Codex's own confirm UI, not by this repo's `canUseTool` gate** (that's harness-only).

**Plugin (recommended)** — the repo ships a Codex plugin ([`.codex-plugin/`](../.codex-plugin/)) bundling the skill and MCP server:
```bash
codex plugin marketplace add SpreadXAI/matrix
# then open /plugins, search "SpreadX", Install
```

**Manual** — add the server to `~/.codex/config.toml`:
```toml
[mcp_servers.spreadx]
url = "https://mcp.spreadx.ai/"
```

Either way, authorize once: `codex mcp login spreadx`. Full notes: [`docs/codex-setup.md`](codex-setup.md).

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
| `SPREADX_ACCESS_TOKEN` | — | Optional one-off Bearer token override. Normally unset — use `matrix login` instead. Ignored when URL is `mock`. |
| `MATRIX_MODEL` | `claude-sonnet-4-6` | Model the harness drives. |
| `MATRIX_HEADLESS` | `0` | `1` disables interactive approval prompts. |
| `MATRIX_AUTO_APPROVE` | `0` | `1` lets headless mode commit writes (still capped). |
| `MATRIX_MAX_FOLLOW` | `1000` | Hard cap the gate enforces on a real follow write. |
| `MATRIX_MAX_ENGAGEMENT` | `500` | Hard cap on a real engagement write (summed over ops). |
| `MATRIX_TOKEN_STORE` | auto | Where `matrix login` keeps the refresh token: `keychain` (default on macOS) or `file` (0600, default elsewhere). |
| `MATRIX_LOGIN_TIMEOUT_MS` | `300000` | Max time (ms) `matrix login` waits for the browser callback before failing with a clear error. |

Run (no build needed — `tsx` runs the TypeScript directly):

```bash
node --env-file=.env --import tsx src/harness/cli.ts "Check my balance"
# or, with env already exported:
pnpm harness "Check my balance"
```

Install the `matrix` command globally (optional):
```bash
pnpm build && pnpm link --global   # then: matrix "Check my balance"
```

---

## Login (real server)

Against the real server you authorize **once**, then the harness runs unattended:

```bash
matrix login      # opens the browser (Auth Code + PKCE); approve, done
matrix status     # show whether you're logged in and how long the access token is valid
matrix logout     # forget the stored credentials for the current SPREADX_MCP_URL
```

`matrix login` discovers the authorization server from the MCP resource (RFC 9728 → RFC 8414), runs S256 PKCE with `offline_access` using a **fixed pre-registered client id** (no dynamic registration), and stores the **rotating refresh token** keyed by MCP URL. Before each run the harness reuses a valid access token or refreshes it; if nothing is stored it tells you to `matrix login`. Token resolution priority: `mock` → `SPREADX_ACCESS_TOKEN` (one-off override) → stored credentials. (`login` is not needed — and refused — for `SPREADX_MCP_URL=mock`.)

> Tokens are stored in the **macOS Keychain** by default (encrypted at rest); on other platforms, or with `MATRIX_TOKEN_STORE=file`, a `0600` file at `~/.config/spreadx-matrix/credentials.json` is used instead.

> **Upgrading?** matrix no longer self-registers a per-machine client; it uses one fixed client id baked into the CLI. Credentials saved by an older build carry a registration-issued client id that the server no longer honors, so **run `matrix login` once** after upgrading to re-authorize. (No backward compatibility is kept for the old id.)

---

## Usage

The CLI takes one free-text instruction; the agent picks the right tool.

### Read balance / orders

```bash
matrix "Check my balance and package"
matrix "List my recent recharge orders"
matrix "How many followers has plan 7f3a… gained?"
```

### Add followers (a write — previewed first)

```bash
matrix "Add 200 crypto English-speaking followers for @laura"
```
The agent calls `create_follow_plan` with no `confirmation_token` → shows the pool size, would-select, shortfall band → asks you to confirm → on approval calls again with the `confirmation_token` from the preview. In **interactive** mode you get a `y/N` prompt before the real write:

```
⚠️  Approve write?
mcp__spreadx__create_follow_plan {"username":"laura","count":200,"confirmation_token":"<from preview>"}
[y/N]
```

### Engagement: like / retweet / comment (a write)

```bash
matrix "Like this tweet https://x.com/x/status/123 50 times"
```
Unless you name a curve, the agent shows a **three-curve menu** — `viral_burst` / `natural_growth` (default) / `sustained_heat` — each with `Est. completion` (a fixed ~48h window) and `Est. credits` (per-op-type cost, e.g. `like 10×50 + comment 30×10 = …`). The curve only changes the delivery *shape*, so both columns are identical across the three — pick one or name it up front (e.g. `matrix "viral_burst — like <url> 50×"`). Then the usual preview → confirm → commit handshake runs, same as a follow plan.

### Headless / batch

```bash
MATRIX_HEADLESS=1 MATRIX_AUTO_APPROVE=1 MATRIX_MAX_FOLLOW=300 \
  matrix "Add 200 followers for @laura"
```
Headless suppresses prompts. A real write then needs `MATRIX_AUTO_APPROVE=1` **and** must be within the cap, or the gate denies it. Reads and previews always run.

During a long tool call the CLI prints progress heartbeats (e.g. `… create_follow_plan still running (8s)`) to **stderr**, so they never mix into the captured result on stdout.

---

## How the write gate decides (harness)

The gate is `src/core/writeGate.ts`, wired as the SDK's `canUseTool`:

```
tool call
 ├─ read tool (get_balance/list_orders/get_order/list_plans/get_plan/estimate_follow_cost) ▶ ALLOW
 ├─ not an mcp__spreadx__* tool ───────────────────────────────────────────────▶ DENY
 └─ write tool (create_follow_plan / create_engagement_plan)
      ├─ no confirmation_token  (preview) ────────────────────────────────▶ ALLOW  (no side effects)
      └─ confirmation_token present  (real write)
           ├─ count invalid / < 1 / > cap ──────────────────────────────────▶ DENY   (fail closed)
           ├─ headless: MATRIX_AUTO_APPROVE=1 ? ──────────────────── ALLOW : DENY
           └─ interactive: stdin y/N ─────────────────────────────── ALLOW : DENY
```

The model cannot route around this — write tools are excluded from the SDK's `allowedTools`, so they always reach the gate. This is verified by `src/harness/allowedTools.test.ts` and `src/harness/gate.integration.test.ts` (model-independent).

---

## The dev mock

`SPREADX_MCP_URL=mock` swaps the remote server for an in-process MCP server (`src/mock/server.ts`) so you can develop and demo offline.

- **Implements:** `get_balance` and `create_follow_plan` (incl. the dry-run preview and the server's `shortfall > 10% ⇒ reject-on-commit` guard).
- **Does not implement:** `list_orders`, `get_order`, `list_plans`, `get_plan`, `create_engagement_plan`. Asking for orders or a like against the mock will fail — verify those against the real server (`list_plans`/`get_plan` already ship in `spreadx-mcp-user`).
- It's **dev-only** and throwaway once the real server is deployed.

---

## Cutover to the real server

When `spreadx-platform` deploys `mcp.spreadx.ai`:

- **Editor:** nothing to change — `.mcp.json` already points there; first use triggers OAuth.
- **Harness:** set `SPREADX_MCP_URL=https://mcp.spreadx.ai/`, then run `matrix login` once (browser OAuth → rotating refresh token in the Keychain/0600 file; the harness refreshes unattended after that). `SPREADX_ACCESS_TOKEN` remains an optional one-off override. No code change.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `SPREADX_ACCESS_TOKEN is required when SPREADX_MCP_URL is not 'mock'` | Set a token, or use `SPREADX_MCP_URL=mock` for offline dev. |
| `agent run did not succeed: …` | The model run ended in error (`error_max_turns`, auth, network). The subtype tells you which; check `ANTHROPIC_API_KEY` and the MCP URL. |
| `401` / re-authorize | The OAuth session lapsed. Editor: re-run the browser flow. Harness: run `matrix login` again (or, for a one-off, set a fresh `SPREADX_ACCESS_TOKEN`). |
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
- [`src/core/spreadx-tools.json`](../src/core/spreadx-tools.json) — hand-synced snapshot of the spreadx-platform tool surface (`packages/services/mcp-user/tools.json`; until that ships, the 9-name target pinned by the platform completion design (incl. `estimate_follow_cost`) — last synced against platform `e17877a`). The CI guardrail (`src/core/tools.guardrail.test.ts`) asserts the matrix registry is a subset of it. Refresh by copy when adopting a newly shipped server tool.
