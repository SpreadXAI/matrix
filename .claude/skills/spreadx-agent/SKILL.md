---
name: spreadx-agent
description: Operates a user's SpreadX account via the spreadx MCP tools — balance, orders, add followers, like/retweet/comment. Use when the user asks about their balance/余额积分, orders/订单, 加粉/followers for @x, 点赞/liking a tweet, or a plan's progress.
---

# SpreadX Agent skill

Translate natural-language asks into `mcp__spreadx__*` tool calls. Always preview a write before committing it, and respond in the user's own language. Each tool's exact parameters live in its own MCP description/schema — rely on those rather than guessing; this skill covers *when* and *in what order* to call the tools, and how to handle the results.

## Tools (all named `mcp__spreadx__<name>`)

| Intent | Tool |
|---|---|
| Balance / points / package | `get_balance` (read-only) |
| List orders | `list_orders` (read-only) |
| One order | `get_order` (read-only) |
| Plan progress | `get_plan_status` (read-only) |
| Add followers | `create_follow_plan` (write) |
| Like / retweet / comment | `create_engagement_plan` (write) |

## Two-step write protocol — ALWAYS

The write tools (`create_follow_plan`, `create_engagement_plan`) take `confirm` (default `false`):

1. **Preview** — call with `confirm: false`. The server returns a dry-run carrying, per operation, `pool_size`, `would_select`, `shortfall`, and `eta_*`.
2. **Present the numbers and the shortfall band, then wait for the user's go-ahead.** Only then call again with `confirm: true`.

Never send `confirm: true` first, even under time pressure. The runtime's own approval UI (Claude plan mode / harness gate / Codex confirm) is a second gate, not a substitute for showing the preview.

### Shortfall bands

Compute `pct = shortfall / requested × 100` for each operation, then act on the worst band:

| Band | Meaning | Default action |
|---|---|---|
| `≤5%` | pool is sufficient; the gap is negligible | proceed with `confirm: true`, same count |
| `5–10%` | pool is slightly tight | ask whether to proceed, or lower the count to match the pool |
| `>10%` | pool is insufficient | do not proceed — offer to lower the count or relax `tags`. The server also rejects `confirm: true` above 10%. |

## Flows

- **Balance** — call `get_balance`; report `points.balance`, `wallet_balance`, `package`.
- **Add followers** (e.g. "add 200 crypto English followers to @laura") — `create_follow_plan({ username: "laura", count: 200, tags: ["crypto","en"], confirm: false })` → present the preview → on approval, repeat the call with `confirm: true` → report `{ plan_id, status }`.
- **Engagement** (e.g. "like this tweet 50 times") — `create_engagement_plan({ tweet_url: "<url>", operations: [{ type: "like", count: 50 }], confirm: false })` → preview → approval → `confirm: true`.

## Errors

Map the MCP error to a clear, language-matched message: `401` → re-authorize (the client handles the redirect); `403` → missing scope (`plans:write` for writes) or another user's plan; `404` → not found; `422` → invalid field or insufficient pool; `429` → surface `Retry-After`.
