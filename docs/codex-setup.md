# Using SpreadX from Codex

Codex is an MCP client, so the `spreadx` tools work in Codex too. Codex also loads
skills natively, but the dry-run / confirmation-token contract is carried by each write tool's own
`description`, so it holds **with or without** the skill. Codex writes are gated by the
**server-side** shortfall guard + Codex's own confirm UI (the matrix `canUseTool` gate
is harness-only).

## Plugin (recommended)

The repo ships a Codex plugin ([`.codex-plugin/`](../.codex-plugin/)) that bundles the
`spreadx-agent` skill and registers the `spreadx` MCP server with the **pre-registered
client id `spreadx-matrix`** (the `spreadx` server doesn't support OAuth Dynamic Client
Registration, so a `url`-only entry can't authorize).

```bash
codex plugin marketplace add SpreadXAI/matrix      # add this repo as a plugin source
```

Then open the plugin picker and install it:

```
/plugins        # search "SpreadX", select Install
```

> Self-serve, non-interactive install commands are still rolling out in Codex; until
> then use the `/plugins` picker after `marketplace add`. Pin a ref with
> `codex plugin marketplace add SpreadXAI/matrix --ref main` if needed.

First tool use triggers the one-time OAuth: `codex mcp login spreadx`.

## Manual config (no plugin)

Add the server with the CLI (writes the entry for you):

```bash
codex mcp add --url https://mcp.spreadx.ai/ --oauth-client-id spreadx-matrix spreadx
```

…or edit `~/.codex/config.toml` directly:

```toml
[mcp_servers.spreadx]
url = "https://mcp.spreadx.ai/"

[mcp_servers.spreadx.oauth]
client_id = "spreadx-matrix"
```

The `[mcp_servers.spreadx.oauth].client_id` is **required** — without it Codex falls back to
Dynamic Client Registration, which the `spreadx` server rejects (`does not support dynamic
client registration`). Note Codex uses snake_case `client_id` here, whereas Claude Code's
`.mcp.json` uses camelCase `clientId` — same value, different key per client.

Authorize once: `codex mcp login spreadx`.

> Requires a current Codex CLI with remote streamable-http MCP + OAuth (verified on
> `codex-cli 0.142.3`, which exposes `--oauth-client-id`). Older builds (stdio-only)
> should use this repo's harness (`pnpm harness "..."`) instead.

## What you can ask

```
Check my balance
Add 200 crypto English-speaking followers for @laura
Like this tweet <url> 50 times
```

Writes are previewed (dry-run) first; you approve, then they run. See the
[main README](../README.md) and [usage guide](usage.md) for the full tool list and the
two-step write protocol.

## Troubleshooting — "the `spreadx` tools aren't there"

`codex mcp list` shows `spreadx` enabled, but the model has no `mcp__spreadx__*` tools in
the conversation. **This is an auth-at-startup problem, not a config problem.** Codex attaches
an MCP server's tools **when the session starts**; if OAuth isn't valid at that moment the
server fails to initialize and its tools never load. A mid-session `codex mcp login` refreshes
the stored credentials but does **not** retro-attach tools to the running session.

Fix — authorize once, then restart:

```bash
codex mcp login --scopes balance:read,orders:read,plans:write,offline_access spreadx
# then start a NEW Codex session (tools load at session start)
```

The `offline_access` scope is the important part: it grants a refresh token, so Codex
re-authorizes **silently** at every later startup and the login step effectively disappears
(stay-logged-in, like a Figma integration). Without it, the token lapses and you hit this again.

Do **not** debug it by inspecting `~/.codex`, SQLite databases, the keychain, or binary
strings for tokens — that never surfaces the tools and only wastes the session. If you need
results before restarting, use the repo's standalone harness, which authorizes independently
of the Codex app's MCP layer:

```bash
pnpm harness "Check my balance"      # uses `matrix login`, not the Codex MCP session
```
