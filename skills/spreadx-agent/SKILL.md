---
name: spreadx-agent
description: Operates a user's SpreadX account via the spreadx MCP tools — balance, orders, plans, add followers, like/retweet/comment. Use when the user asks to check balance or points, view orders, list their plans or campaigns, add followers to @x, like a tweet, or check how a plan is progressing.
---

# SpreadX Agent skill

Translate natural-language asks into `mcp__spreadx__*` tool calls. Always preview a write before committing it, and respond in the user's own language. Each tool's exact parameters live in its own MCP description/schema — rely on those rather than guessing; this skill covers *when* and *in what order* to call the tools, and how to handle the results.

## Tools (all named `mcp__spreadx__<name>`)

| Intent | Tool |
|---|---|
| Balance / points / package | `get_balance` (read-only) |
| List orders | `list_orders` (read-only) |
| One order | `get_order` (read-only) |
| List my plans / how are they doing | `list_plans` (read-only) |
| One plan's progress | `get_plan` (read-only) |
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

### Speed presets

Both write tools take `speed` (default `standard`). It is one of three presets that collapse delivery pace into a single choice — same wording as the web velocity pills. The server rejects any other value.

| `speed` | Label | Feel | Rate |
|---|---|---|---|
| `standard` | Standard / 标准 | human-like pace / 真人节奏 | ~30–50/day |
| `boost` | Boost / 快速 | same-day delivery / 当日完成 | ~150–200/day |
| `turbo` | Turbo / 爆发 | launch burst / 上新集中 | ~400–500/day |

Pick from the user's wording — "尽快/今天就要/launch" → `boost` or `turbo`; "慢慢来/自然/真人" → `standard`. When pace is unstated, omit `speed` (defaults to `standard`); only ask if the count is large enough that the choice clearly matters. The preview's `eta_*` reflects the chosen speed, so surface it when confirming.

## Flows

- **Balance** — call `get_balance`; report `points.balance`, `wallet_balance`, `package`.
- **Add followers** (e.g. "add 200 crypto English followers to @laura, fast") — `create_follow_plan({ username: "laura", count: 200, tags: ["crypto","en"], speed: "boost", confirm: false })` → present the preview (numbers + shortfall + `eta_*`) → on approval, repeat the call with `confirm: true` → report `{ plan_id, status }`. Omit `speed` when pace is unstated.
- **Engagement** (e.g. "like this tweet 50 times") — `create_engagement_plan({ tweet_url: "<url>", operations: [{ type: "like", count: 50 }], confirm: false })` → preview → approval → `confirm: true`. Add `speed` (same presets) when the user signals urgency.
- **Check plans** (e.g. "how are my campaigns doing", "list my plans") — `list_plans({ status_group?, target?, limit? })` returns a newest-first page (`plans[]` + `next_cursor`). Every row already carries progress (`total_items` / `completed_items` / `failed_items`), so summarize straight from the list — no per-plan fan-out. For one plan's detail, `get_plan({ plan_id })`. This is also the follow-up after a `create_*_plan` returns a `plan_id` (the "check status any time" loop).
  - `status_group` is one of `open | done | failed | cancelled | partial` (the server expands these, e.g. `open` → pending/executing/paused). Pass only these tokens; do not invent an `active`/`completed` taxonomy.
  - `target` filters by a Twitter handle. `next_cursor` is opaque — pass it back verbatim to page; never build or parse it.

## Errors

Map the MCP error to a clear, language-matched message: `401` → re-authorize (Claude Code / Codex run the OAuth redirect themselves; the matrix harness auto-refreshes the access token each run, so a persistent `401` means running `matrix login` again); `403` → missing scope (`plans:write` for writes) or another user's plan; `404` → not found; `422` → invalid field or insufficient pool; `429` → surface `Retry-After`.
