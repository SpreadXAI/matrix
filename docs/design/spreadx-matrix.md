---
title: SpreadX Matrix — agent client (Skill + MCP client) for the SpreadX end-user MCP
path: /docs/design/spreadx-matrix.md
audience: [agent, engineer]
topics: [mcp, oauth, agent, skill, harness]
status: proposed
owner: milhous
prerequisites:
  - spreadx-platform:/docs/design/spreadx-mcp-user.md
---

# SpreadX Matrix (`spreadx-matrix`)

This repo is the **consumer side** of SpreadX's "agent acts on behalf of the user" capability. `spreadx-platform` owns the MCP **server** (the OAuth Resource Server `spreadx-mcp-user` at `https://mcp.spreadx.ai/`); this repo owns everything that **calls** it: letting a Claude / Codex agent, after one OAuth authorization, **check balance, check orders, grow followers (follow), and engage (like/retweet/comment)**.

> This and `spreadx-platform/docs/design/spreadx-mcp-user.md` are the two ends of one system: that side defines the tool contract and authorization; this side only does **integration + orchestration + Skill polish + a deterministic write gate**. **It copies no server business logic and makes no authorization decisions of its own.**

## Design principles (this review's baseline: avoid over-engineering)

1. **The contract lives in the tools; the Skill only polishes.** The hard contract — dry-run / confirm / reject-if-shortfall>10% — is written into the **server tools' own descriptions**. Codex obeys it with no skill; the Claude-side Skill only adds phrasing. **One contract, maintained once.**
2. **The safety boundary is deterministic code, not the LLM.** On the headless path the only thing that can authorize a real write (`confirm=true`) is the harness `canUseTool` gate (human approval + amount caps). The model may *propose* anything but can never *execute* a write the gate denies.
3. **The client does not duplicate server authorization.** Scope checks, the shortfall>10% rejection, rate limiting, and the 60s JWT TTL all live server-side. The client gate adds only "human-in-the-loop" + "amount caps", and only on the headless autonomous path.
4. **Use what the SDK already provides instead of adding dependencies.** The local mock uses the Agent SDK's own **in-process MCP server** — no `@modelcontextprotocol/sdk`, no hand-rolled HTTP transport.

## Three deliverables

```
                          ┌─ Claude Code / Codex (in-editor; already an MCP client) ─┐
 Editor path  ──────────▶ │  .mcp.json / config.toml mounts the remote spreadx       │
                          │  + spreadx-agent Skill (Claude only; UX polish)          │
                          └──────────────────────────────────────────────────────────┘
                          ┌─ Standalone harness (this repo, src/) ───────────────────┐
 Programmatic / headless ▶│  Claude Agent SDK · query()                              │
                          │   ├ mcpServers: { spreadx: type http, Bearer }           │
                          │   ├ skills: spreadx-agent                                │
                          │   └ canUseTool: deterministic write gate (approval+caps) │  ← the only headless safety gate
                          │  matrix CLI (free-text passthrough)                      │
                          └──────────────────────────────────────────────────────────┘
                          ┌─ Local dev mock (dev-only, throwaway) ───────────────────┐
 Offline dev ───────────▶ │  Agent SDK in-process MCP server: get_balance +          │
                          │  create_follow_plan (mirrors the server shortfall guard) │
                          └──────────────────────────────────────────────────────────┘
                                          │ all three ultimately hit →
                                          ▼  https://mcp.spreadx.ai/ (owned by the platform)
```

### 1. Editor path (config + Skill)
- `.mcp.json` (Claude Code): `{ spreadx: { type: "http", url: "https://mcp.spreadx.ai/" } }`.
  **OAuth is run by Claude Code itself** (the server's 401 + `WWW-Authenticate resource_metadata` triggers DCR + browser authorization); **no token in the config.**
- `skills/spreadx-agent/SKILL.md`: superpowers format — balance/orders/follow/like phrasing + the two-step protocol + shortfall bands. **Pure UX, not functionally required.**
- `docs/codex-setup.md`: the Codex `config.toml` snippet + `codex mcp login`.
  **Codex's write protection = the server-side guard + Codex's own confirm UI; it does not pass through matrix's canUseTool gate** (that gate lives only in the harness).

### 2. Standalone harness (Agent SDK)
- `runAgent(prompt)`: one headless `query()` that mounts the spreadx MCP (`type: "http"` + `Authorization: Bearer`), loads the `spreadx-agent` skill, and uses `makeWriteGate(...)` as `canUseTool`.
- `matrix` CLI: free-text passthrough (`matrix "Check my balance"` / `matrix "Add 200 followers for @laura"`); in interactive mode writes go through a stdin approval.
- **Deterministic write-gate semantics**:
  - Read tools (`get_balance`/`list_orders`/`get_order`/`get_plan_status`) → allow directly.
  - A write tool with `confirm` not true (preview) → allow (the preview has no side effects).
  - A write tool with `confirm=true` → check caps first (over `MATRIX_MAX_FOLLOW`/`MATRIX_MAX_ENGAGEMENT` → deny); interactive → ask the human; headless → allow only if `MATRIX_AUTO_APPROVE=1` and within cap, else deny.
  - Any tool outside the `mcp__spreadx__*` namespace → deny (allowlist). An *unknown* spreadx tool fails safe: it is treated as a write and always requires approval.

### 3. Local dev mock (dev-only)
- An Agent SDK in-process MCP server that implements only **`get_balance` + `create_follow_plan`** (enough to exercise a read + the two-step write).
  `create_follow_plan` mirrors the server's "reject `confirm=true` when shortfall>10%" guard.
- Active only when `SPREADX_MCP_URL` points at the mock. **Discardable once platform staging is live.**

## Structured tool output

MCP structured tool output (spec 2025-06-18, STABLE) is the recommended way to return tool results: a tool declares an `outputSchema` and returns `structuredContent` (the typed object) **and** a text block (the serialized JSON, a backward-compatible fallback). This lets clients validate/consume typed data instead of parsing free-text JSON.

- **This repo:** the dev mock returns `structuredContent` next to the text fallback (via `toolResult()`), and the output shapes are typed contracts in `src/mock/tools.ts` (`BalanceOutput`, `FollowPlanOutput`). The mock also sets MCP tool **annotations** (`readOnlyHint` etc.) to model a well-behaved server — though the write gate deliberately does **not** trust them (the spec treats annotations as advisory, not a security boundary).
- **SDK limit:** the Agent SDK's in-process `tool()` can attach annotations and return `structuredContent`, but it cannot *declare* an `outputSchema`. Whether `structuredContent` is surfaced to the model is SDK-internal; the text fallback always works.
- **Cross-repo requirement (platform):** the real `spreadx-mcp-user` server should declare `outputSchema` and return `structuredContent` matching these shapes for every tool. The client/SDK consumes `structuredContent` when present; until the server ships it, results degrade gracefully to the text fallback.

## Authorization model (who gets the token)

| Path | How the token is obtained | Notes |
|---|---|---|
| Claude Code (`.mcp.json`) | client-managed OAuth (DCR + PKCE + browser) | zero-config token |
| Codex (`config.toml`) | `codex mcp login spreadx` | needs a recent Codex |
| **harness** | `matrix login` (browser Auth Code + PKCE, once) — or paste `SPREADX_ACCESS_TOKEN` for a one-off | unattended-capable |

**Unattended auth (`matrix login`, implemented in `src/auth/`):** `matrix login` discovers the AS from the MCP resource (RFC 9728 → RFC 8414), dynamically registers a public loopback client (RFC 7591), runs Authorization Code + S256 PKCE (RFC 7636) with the `resource` indicator (RFC 8707) and `offline_access`, and stores the **rotating refresh token** at `~/.config/spreadx-matrix/credentials.json` (mode 0600), keyed by MCP URL. Before each run, `resolveAccessToken` reuses a still-valid access token or refreshes it (persisting the rotated refresh token); if there are no credentials it tells the user to run `matrix login`. Priority order: mock → `SPREADX_ACCESS_TOKEN` env override → stored credentials. The token store is an interface, so a macOS Keychain backend can replace the 0600 file later without touching callers.

## Scope / Not in scope

**In scope:** `.mcp.json`, the `spreadx-agent` Skill, the Codex doc, the Agent SDK harness + CLI, the deterministic write gate, the in-process dev mock, the OAuth **client** (`matrix login`: discovery + DCR + PKCE + refresh, in `src/auth/`), and the unit tests (which do not depend on the LLM).

**Not in scope:** the MCP server and the OAuth **Authorization Server** (both owned by the platform), production-grade secret storage beyond a 0600 file (macOS Keychain is a follow-up behind the same interface), re-implementing the server's shortfall/scope logic, and mocks for `list_orders`/`get_order`/`get_plan_status`/`create_engagement_plan` (end-to-end verification runs against platform staging).

## Cross-repo dependency and cutover

`.mcp.json` and the harness reach the **real** server only once `spreadx-platform` finishes **Phase B.4** (FastMCP streamable-http transport) and deploys `mcp.spreadx.ai`. Until then the editor/harness run the local dev mock; the deterministic write gate and core logic are fully covered by unit tests. **Cutover = change one env var, `SPREADX_MCP_URL`**, with no code change.

## Security model (three layers, each with its own job)

| Layer | Enforced by | What it covers |
|---|---|---|
| Server (authoritative) | `spreadx-mcp-user` | scope checks, reject `confirm` when shortfall>10%, rate limiting, the 60s platform-JWT TTL, revocation at the AS |
| Harness write gate (deterministic) | this repo's `canUseTool` | human approval + amount caps before a real write; **the only headless safety gate** |
| Editor-native confirmation | Claude plan mode / Codex confirm | the second human gate in interactive use |

The client does **not** replicate any of the server's authorization decisions; the gate only adds "human-in-the-loop + caps", and only for the autonomous path.
