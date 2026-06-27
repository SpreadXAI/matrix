---
name: spreadx-agent
description: Operate a user's SpreadX account through the spreadx MCP tools — check balance and orders, and create follow / like-retweet-comment growth plans. Use when the user asks "我的余额/积分还有多少", "看看我的订单", "帮 @X 加 N 粉", "给这条推点 N 个赞/评论/转发", or to check a plan's progress. Requires the spreadx MCP server connected (one-time OAuth).
---

# SpreadX Agent skill

Turn natural-language asks into `mcp__spreadx__*` tool calls, always previewing writes before committing.

## Tools

| Intent | Tool | Notes |
|---|---|---|
| 余额 / 积分 / 套餐 | `get_balance` | read-only |
| 订单列表 | `list_orders` | `limit`, `cursor` |
| 单个订单 | `get_order` | `order_id` |
| plan 进度 | `get_plan_status` | `plan_id` |
| 涨粉 | `create_follow_plan` | `username`, `count`, `tags?`, `speed?`, `confirm` |
| 互动(赞/转/评) | `create_engagement_plan` | `tweet_url`|`tweet_id`, `operations[{type,count,content_config?}]`, `confirm` |

## Two-step write protocol — ALWAYS

Write tools take `confirm` (default `false`):
1. **Preview** — call with `confirm: false` → server returns dry-run: per-op `pool_size`, `would_select`, `shortfall`, `eta_*`.
2. **Show the numbers + shortfall band, wait for go-ahead**, then call again with `confirm: true`.

Never send `confirm: true` first. The runtime's approval UI (Claude plan mode / harness gate / Codex confirm) is the second gate.

### Shortfall bands

| shortfall vs requested | say | default |
|---|---|---|
| `≤5%` | "池子足够,差 X 个可忽略" | proceed `confirm:true` |
| `5–10%` | "池子略紧,差 X 个 (Y%)" | ask: proceed or lower count? |
| `>10%` | "池子不够 — 需要 X 只有 Y" | do NOT proceed; server also rejects `confirm:true` |

`%` = `shortfall / requested × 100`.

## Flows
- **查余额**: `get_balance` → report `points.balance`, `wallet_balance`, `package`.
- **帮 @laura 加 200 crypto 英文粉**: `create_follow_plan({username:"laura",count:200,tags:["crypto","en"],confirm:false})` → preview → on approval same call `confirm:true` → report `{plan_id,status}`.
- **给这条推点 50 个赞**: `create_engagement_plan({tweet_url:"<url>",operations:[{type:"like",count:50}],confirm:false})` → preview → approval → `confirm:true`.

## Errors
- `401` → re-authorize (client handles redirect). `403` → missing scope / others' plan. `422` → field invalid / pool insufficient. `429` → surface `Retry-After`.
