# SpreadX Matrix

**Operate a SpreadX account from your AI agent.** Install one plugin, authorize once in the browser, then just ask — *"查一下我的余额"*, *"帮 @laura 加 200 个 crypto 英文粉"*, *"给这条推点 50 个赞"* — and Claude (or Codex) does it through the **spreadx MCP server**, with a dry-run preview and your approval before any real write.

> This repo is the **client** side. The MCP **server** (`spreadx-mcp-user`, an OAuth Resource Server at `https://mcp.spreadx.ai/`) lives in **`spreadx-platform`**. This repo ships the Skill, the MCP wiring, and a standalone harness — it copies no server logic and makes no authorization decisions of its own.

---

## Quickstart

**Claude Code** — install the plugin, then ask:

```
/plugin marketplace add SpreadXAI/matrix
/plugin install spreadx-matrix@spreadx-matrix
```

That registers the `spreadx` MCP server **and** the `spreadx-agent` Skill. On first use a browser window opens for a one-time OAuth authorization. Then:

```
查一下我的余额
帮 @laura 加 200 个 crypto 英文粉
```

That's it. Read on for Codex, the standalone harness, and how the safety gate works.

---

## How it works

You speak in plain language; the agent does **not** fire off a destructive write blindly. The `spreadx-agent` Skill (and, for clients without skills, the MCP tools' own descriptions) enforce a **two-step protocol**: every write is first run as a **dry-run preview** (pool size, how many accounts would be selected, shortfall, ETA), shown to you, and only executed after you approve. Reads (balance, orders, plan status) run directly.

The protocol lives in the tools, so **Codex obeys it with no Skill at all**. The Claude Skill is pure phrasing on top. And in the standalone harness, a deterministic `canUseTool` gate — not the model — is the final authority on whether a real write runs.

---

## Installation

The capability is two things: a **Skill** (phrasing/UX) and the **`spreadx` MCP server** (the actual tools). How you install them depends on your client.

### Claude Code (plugin — installs both)

```
/plugin marketplace add SpreadXAI/matrix
/plugin install spreadx-matrix@spreadx-matrix
```

The plugin ([`.claude-plugin/`](.claude-plugin/)) bundles the `spreadx-agent` Skill and registers the remote MCP server. First tool use triggers the one-time browser OAuth (login via Privy, approve scopes). No tokens to paste, nothing at rest.

> Prefer not to use the plugin? Just register the server — `claude mcp add --transport http spreadx https://mcp.spreadx.ai/` — and optionally copy `.claude/skills/spreadx-agent/` into your project's `.claude/skills/`.

### Codex

Codex is an MCP client with no Skill system; the tools' own descriptions carry the protocol. Add to `~/.codex/config.toml`:

```toml
[mcp_servers.spreadx]
url = "https://mcp.spreadx.ai/"
```

Then `codex mcp login spreadx`. Codex writes are gated by the **server-side** guard plus Codex's own confirm UI. Full notes: [`docs/codex-setup.md`](docs/codex-setup.md).

### Standalone harness (scripts / headless)

A `matrix` CLI that drives the agent programmatically, with the deterministic write gate built in.

```bash
git clone https://github.com/SpreadXAI/matrix && cd matrix
pnpm install
cp .env.example .env          # set ANTHROPIC_API_KEY; SPREADX_MCP_URL=mock for offline dev
node --env-file=.env --import tsx src/harness/cli.ts "查一下我的余额"
```

`SPREADX_MCP_URL=mock` runs against a built-in in-process mock — no platform, no token — so you can try the flow today. See [`docs/usage.md`](docs/usage.md) for every env var and option.

---

## The Basic Workflow

Once installed, the loop for any task is the same four phases:

1. **Authorize (once)** — the client runs the OAuth flow in your browser. The grant is held by the authorization server; you won't log in again.
2. **Ask in natural language** — the `spreadx-agent` Skill maps your request to the right `mcp__spreadx__*` tool. Reads return immediately.
3. **Preview before writing** — for a follow/engagement plan, the agent calls the tool with `confirm:false` first and shows you the dry-run: pool size, would-select, **shortfall band** (`≤5%` proceed · `5–10%` ask · `>10%` don't), and ETA.
4. **Approve, then execute** — on your go-ahead it re-calls with `confirm:true`. In the harness this passes through the gate (your `y/N`, or headless auto-approve within caps); in editors it's the client's own approval UI. The server rejects any write whose shortfall exceeds 10%.

Then **check status** (`get_plan_status`) any time. The same workflow covers `create_follow_plan` (涨粉) and `create_engagement_plan` (赞/转/评).

```
You:    帮 @laura 加 200 个 crypto 英文粉
Agent:  [dry-run] pool 1,000 · would select 200 · shortfall 0 (ok) · ETA ~12m. 执行?
You:    ok
Agent:  [confirm] plan mock-plan-1 created ✅
```

---

## What's Inside

**Tools** (exposed to the agent as `mcp__spreadx__<tool>`):

| Tool | Kind | Scope (server-enforced) | What |
|---|---|---|---|
| `get_balance` | read | `balance:read` | points / wallet / package |
| `list_orders` | read | `orders:read` | recharge orders (keyset paging) |
| `get_order` | read | `orders:read` | one order |
| `get_plan_status` | read | `orders:read` | a plan's progress |
| `create_follow_plan` | **write** | `plans:write` | add followers to a user |
| `create_engagement_plan` | **write** | `plans:write` | like / retweet / comment on a tweet |

**Components in this repo:**

- `.claude-plugin/` — the Claude Code plugin (marketplace + manifest) bundling the Skill and MCP server
- `.claude/skills/spreadx-agent/SKILL.md` — the Skill (UX phrasing over the tools)
- `.mcp.json` — project-mode MCP mount (for cloning this repo directly)
- `docs/codex-setup.md` — Codex setup
- `src/core/writeGate.ts` — the deterministic `canUseTool` safety gate
- `src/harness/{client,cli}.ts` — the Agent SDK harness + `matrix` CLI
- `src/mock/` — in-process dev mock (balance + follow), so the harness runs offline

**The safety gate** (harness): read tools and write *previews* are auto-allowed; a real write (`confirm:true`) must pass an amount cap (`MATRIX_MAX_FOLLOW` / `MATRIX_MAX_ENGAGEMENT`) and then approval (interactive `y/N`, or `MATRIX_AUTO_APPROVE=1` headless). It **fails closed** on a missing/invalid count or any non-spreadx tool, and write tools are deliberately kept out of the SDK's `allowedTools` so they can't be auto-approved around the gate. Enforced by code, locked by tests — independent of the model.

---

## Updating

```
/plugin marketplace update spreadx-matrix    # fetch the latest version
```

Uninstall with `/plugin uninstall spreadx-matrix`. For the harness, `git pull && pnpm install`.

---

## Security

No secrets at rest. The plugin/editor path uses client-managed OAuth (no token in any config); the harness reads `SPREADX_ACCESS_TOKEN` from env only. `.env` and `.mcp.local.json` are git-ignored — never commit a token. Revocation lives in the OAuth layer (the platform AS / dashboard); the access token's short TTL bounds any leak.

---

## Status & roadmap

- ✅ Plugin, Skill, editor config, harness, deterministic write gate, in-process mock — implemented and tested (23 tests).
- ⏳ **Real server** — the MCP URL `mcp.spreadx.ai` is reachable once `spreadx-platform` ships **Phase B.4** (FastMCP streamable-http) and deploys. Until then use `SPREADX_MCP_URL=mock`; cutover is one env var.
- ⏳ **Live model smoke** — the LLM-driven tool loop needs an `ANTHROPIC_API_KEY` (run it against the mock). The gate, config, and mock logic are already proven by tests + no-key runtime smokes.

## See also

- **[`docs/usage.md`](docs/usage.md)** — installation & usage, in depth
- **[`docs/design/spreadx-matrix.md`](docs/design/spreadx-matrix.md)** — design spec
- **`spreadx-platform`** — the MCP server (`spreadx-mcp-user`) and OAuth authorization server
