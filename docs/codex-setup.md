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
