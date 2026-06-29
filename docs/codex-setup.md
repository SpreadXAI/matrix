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
