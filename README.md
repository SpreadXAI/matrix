# spreadx-matrix

**Agent client for the SpreadX end-user MCP** — a Claude/Codex Skill plus an MCP client (editor config + a standalone harness) that lets an AI agent, after one OAuth authorization, operate a user's SpreadX account: **check balance & orders, and run follow / like-retweet-comment growth plans**.

> This repo is the **consumer side**. The MCP **server** (`spreadx-mcp-user`, an OAuth Resource Server at `https://mcp.spreadx.ai/`) lives in **`spreadx-platform`**. This repo owns everything that *calls* it: the Skill, the editor wiring, and a programmatic harness with a deterministic write gate. It copies no server business logic and makes no authorization decisions of its own.

---

## Why this exists

A SpreadX user wants to say *"帮 @laura 加 200 个 crypto 英文粉"* to their AI agent and have it happen — safely, on their behalf, without pasting API keys. The platform exposes that capability as MCP tools behind OAuth. This repo makes any MCP-capable agent (Claude Code, Claude Desktop, Codex) able to use them, and adds the one thing a server can't: a **client-side, deterministic guardrail** so an autonomous agent can never commit a real write the user didn't approve.

Two design principles, inherited from the platform's contract:

- **The contract lives in the tools, the Skill only polishes.** The dry-run → confirm → shortfall protocol is encoded in the MCP tools' own descriptions (server-side), so Codex obeys it with no Skill at all. The Claude Skill here is pure UX phrasing. One contract, two clients.
- **Safety is deterministic, not the LLM.** On the headless path the *only* authorizer of a real write is a plain `canUseTool` function (human approval + amount caps, fail-closed). The model may propose anything; it can never execute a denied write.

---

## Architecture (client side)

```
                       ┌─ Claude Code / Codex (your editor — already an MCP client) ─┐
 Editor path  ───────▶ │  .mcp.json / config.toml  mounts the remote spreadx server  │
                       │  + spreadx-agent Skill (Claude only; UX phrasing)           │
                       └─────────────────────────────────────────────────────────────┘
                       ┌─ Standalone harness (src/) ────────────────────────────────┐
 Programmatic /        │  Claude Agent SDK · query()                                 │
 headless path ──────▶ │   ├ mcpServers  → remote (Bearer) or in-process mock        │
                       │   ├ skills: spreadx-agent                                   │
                       │   └ canUseTool: deterministic write gate (approval + caps)  │  ← sole headless write authorizer
                       │  `matrix "<natural language>"`  CLI                         │
                       └─────────────────────────────────────────────────────────────┘
                                          │  all three terminate at →
                                          ▼  https://mcp.spreadx.ai/   (owned by spreadx-platform)
```

---

## Two ways to use it

| | **Editor path** | **Standalone harness** |
|---|---|---|
| For | Interactive use inside Claude Code / Codex | Scripts, batch, headless automation |
| Auth | Client-managed OAuth (browser, once) | Paste a short-lived access token via env |
| Safety gate | Editor's own approval UI + server guard | Deterministic `canUseTool` gate + server guard |
| Setup | Drop in `.mcp.json` / `config.toml` | `pnpm install` + `.env` + `matrix …` |
| Skill | `spreadx-agent` auto-loads (Claude) | Same Skill, loaded by the SDK |

Full step-by-step for both: **[`docs/usage.md`](docs/usage.md)**.

### Quick start — Claude Code (editor)

The repo ships [`.mcp.json`](.mcp.json) already pointing at the server. Open this repo in Claude Code, then on first tool use Claude Code runs the OAuth flow (a browser authorize, once). The `spreadx-agent` Skill auto-loads when you ask about balance / orders / follow / like. Then just ask:

```
查一下我的余额
帮 @laura 加 200 个 crypto 英文粉
给这条推 https://x.com/.../status/123 点 50 个赞
```

### Quick start — Codex (editor)

Codex has no Skill system; the tools' own descriptions carry the protocol. See **[`docs/codex-setup.md`](docs/codex-setup.md)** — add the server to `~/.codex/config.toml` and `codex mcp login spreadx`.

### Quick start — standalone harness

```bash
pnpm install
cp .env.example .env          # set ANTHROPIC_API_KEY; SPREADX_MCP_URL=mock for offline dev
node --env-file=.env --import tsx src/harness/cli.ts "查一下我的余额"
```

`SPREADX_MCP_URL=mock` runs against a built-in in-process mock (no platform, no token needed) — ideal for trying the flow today. Point it at the real server (and set `SPREADX_ACCESS_TOKEN`) once the platform is deployed.

---

## Tools

Exposed to the agent as `mcp__spreadx__<tool>` (the editor namespaces them automatically):

| Tool | Kind | Scope (server-enforced) | What |
|---|---|---|---|
| `get_balance` | read | `balance:read` | points / wallet / package |
| `list_orders` | read | `orders:read` | recharge orders (keyset paging) |
| `get_order` | read | `orders:read` | one order |
| `get_plan_status` | read | `orders:read` | a plan's progress |
| `create_follow_plan` | **write** | `plans:write` | add followers to a user |
| `create_engagement_plan` | **write** | `plans:write` | like / retweet / comment on a tweet |

## The two-step write protocol

Every write tool takes `confirm` (default `false`):

1. **Preview** — `confirm:false` → the server returns a dry-run: per-op `pool_size`, `would_select`, `shortfall`, ETA. No state changes.
2. **Show the numbers, present the shortfall band, get approval**, then call again with `confirm:true`.

**Shortfall bands:** `≤5%` proceed · `5–10%` ask · `>10%` don't (the server also rejects `confirm:true` above 10%). The client never re-implements the 10% rule — that's the server's job.

### The deterministic write gate (harness)

The harness's `canUseTool` is the headless safety boundary. It:

- **allows** read tools and write *previews* (no side effects) automatically;
- on a real write (`confirm:true`): enforces an **amount cap** first (`MATRIX_MAX_FOLLOW` / `MATRIX_MAX_ENGAGEMENT`), then requires approval — **interactive** prompts you (`y/N` on stdin); **headless** denies unless `MATRIX_AUTO_APPROVE=1`;
- **fails closed**: a missing/non-numeric/`<1` count, or any tool outside the spreadx allowlist, is denied.

This is enforced by code and locked by tests, independent of the model. Write tools are deliberately kept **out** of the SDK's `allowedTools` so they route through this gate rather than being auto-approved.

---

## Project layout

```
.mcp.json                              # Claude Code → remote spreadx (auto-OAuth)
.claude/skills/spreadx-agent/SKILL.md  # the Skill (UX phrasing over the MCP tools)
docs/
  design/spreadx-matrix.md             # design spec
  codex-setup.md                       # Codex MCP client setup
  usage.md                             # full install + usage guide
  superpowers/plans/…                  # implementation plan (history)
src/
  core/writeGate.ts                    # the canUseTool safety gate
  core/config.ts                       # env → MatrixConfig
  mock/{tools,server}.ts               # in-process dev mock (balance + follow)
  harness/{client,cli}.ts              # Agent SDK harness + `matrix` CLI
```

## Development

```bash
pnpm install
pnpm test       # vitest — 23 tests across 6 files (write gate, config, mock,
                #          gate enforcement, allowedTools, remote-path guard)
pnpm build      # tsc → dist/  (then `matrix` is on the bin path)
```

Tech: Node ≥20, TypeScript (ESM), `@anthropic-ai/claude-agent-sdk`, `zod`. No `@modelcontextprotocol/sdk` — the SDK's own in-process server backs the mock.

## Status & roadmap

- ✅ Skill, editor config, harness, deterministic write gate, in-process mock — implemented and tested.
- ⏳ **Real server** — the editor `.mcp.json` and harness reach `mcp.spreadx.ai` only after `spreadx-platform` ships **Phase B.4** (FastMCP streamable-http transport) and deploys. Cutover from here is one env var: `SPREADX_MCP_URL`.
- ⏳ **Live model smoke** — the LLM-driven tool loop needs an `ANTHROPIC_API_KEY`; run it against the mock (see usage). The deterministic gate, config, and mock logic are already proven by tests + no-key runtime smokes.

## Security

No secrets at rest: the editor path uses client-managed OAuth (no token in `.mcp.json`); the harness reads `SPREADX_ACCESS_TOKEN` from env only. `.env` and `.mcp.local.json` are git-ignored. Never commit a token. Revocation lives in the OAuth layer (the platform AS / dashboard); the access token's short TTL bounds any leak.

## See also

- **[`docs/usage.md`](docs/usage.md)** — installation & usage, in depth
- **[`docs/design/spreadx-matrix.md`](docs/design/spreadx-matrix.md)** — design spec
- **`spreadx-platform`** — the MCP server (`spreadx-mcp-user`) and OAuth AS
