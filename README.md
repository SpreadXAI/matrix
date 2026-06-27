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
node --env-file=.env --import tsx src/harness/cli.ts "查一下我的余额"
```
Interactive mode prompts before any real write. Headless (`MATRIX_HEADLESS=1`) needs
`MATRIX_AUTO_APPROVE=1` to commit writes, and still enforces amount caps.
