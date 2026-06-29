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

The write tools (`create_follow_plan`, `create_engagement_plan`) use a confirmation-token handshake:

1. **Preview** — call with **no** `confirmation_token`. The server returns a dry-run carrying, per operation, `pool_size`, `would_select`, `shortfall`, `target`, `eta_*`, `points_cost_estimate`, and a `confirmation_token`.
2. **Show the confirm dialog (below), then wait for the user's go-ahead.**
3. **Commit** — call again, passing the `confirmation_token` from the preview verbatim. Never fabricate or reuse a token across different requests.

There is no `confirm` flag: a call with no token can only preview, so a one-shot blind write is impossible. The runtime's own approval UI (Claude permission prompt / harness gate / Codex approval) is a second, human gate — not a substitute for showing the dialog.

### Confirm dialog

Mirror the web confirm dialogs; render labels in the user's language.

**Follower growth** (target is an account):

| Field | Source |
|---|---|
| Target Username | `@<username>` (`operations[].target`) |
| Follower Count | `operations[].count` |
| Estimated completion | `eta_finish` → `Ready in ~Nd` (≥24h) / `Ready in ~Nh` |
| Estimated credits | `points_cost_estimate` |
| Current credits | `get_balance` → `points.balance` |
| Remaining credits | Current − Estimated |

**Engagement boost** (target is a tweet): same credits/completion rows, but the target row is **Tweet** (`operations[].target`), listing each op as `type × count` (e.g. like × 50).

Fetch Current credits via `get_balance` and compute Remaining yourself; the preview carries no balance. If `get_balance` is unavailable, show Estimated only and say the balance check was skipped.

### Shortfall bands

Compute `pct = shortfall / requested × 100` for each operation, then act on the worst band:

| Band | Meaning | Default action |
|---|---|---|
| `≤5%` | pool is sufficient; the gap is negligible | proceed to commit with the preview's `confirmation_token`, same count |
| `5–10%` | pool is slightly tight | ask whether to proceed, or lower the count to match the pool |
| `>10%` | pool is insufficient | do not proceed — offer to lower the count or relax `tags`. The server also rejects a commit above 10%. |

### Speed presets

Both write tools take `speed` (default `standard`) — one of three presets that collapse delivery pace into a single choice. The server rejects any other value. **`standard` / `boost` / `turbo` are wire codes: send them verbatim, never translated.** Only the *label* shown to the user is translated.

| `speed` | Meaning (semantic) | Rate |
|---|---|---|
| `standard` | human-like, natural pace | ~30–50/day |
| `boost` | same-day delivery | ~150–200/day |
| `turbo` | launch burst, front-loaded | ~400–500/day |

Render the label in the user's current language from the meaning above. Match the product UI for the two languages it ships — English uses `Standard` / `Boost` / `Turbo`; Chinese uses `标准` / `快速` / `爆发`. For any other language, translate the meaning naturally.

Infer the preset from the user's intent — words like "asap", "today", or "launch" → `boost` or `turbo`; "natural" or "slow" → `standard`. When pace is unstated, omit `speed` (defaults to `standard`); only ask if the count is large enough that the choice clearly matters. The preview's `eta_*` reflects the chosen speed, so surface it in the confirm dialog.

## Flows

- **Balance** — call `get_balance`; report `points.balance`, `wallet_balance`, `package`.
- **Add followers** (e.g. "add 200 crypto English followers to @laura, fast") — `create_follow_plan({ username: "laura", count: 200, tags: ["crypto","en"], speed: "boost" })` → present the preview (numbers + shortfall + `eta_*` + confirm dialog) → on approval, repeat the call **with the preview's `confirmation_token`** → report `{ plan_id, status }`. Omit `speed` when pace is unstated.
- **Engagement** (e.g. "like this tweet 50 times") — `create_engagement_plan({ tweet_url: "<url>", operations: [{ type: "like", count: 50 }] })` → preview → approval → repeat **with the preview's `confirmation_token`**. Add `speed` (same presets) when the user signals urgency.
- **Check plans** (e.g. "how are my campaigns doing", "list my plans") — `list_plans({ status_group?, target?, limit? })` returns a newest-first page (`plans[]` + `next_cursor`). Every row already carries progress (`total_items` / `completed_items` / `failed_items`), so summarize straight from the list — no per-plan fan-out. For one plan's detail, `get_plan({ plan_id })`. This is also the follow-up after a `create_*_plan` returns a `plan_id` (the "check status any time" loop).
  - `status_group` is one of `open | done | failed | cancelled | partial` (the server expands these, e.g. `open` → pending/executing/paused). Pass only these tokens; do not invent an `active`/`completed` taxonomy.
  - `target` filters by a Twitter handle. `next_cursor` is opaque — pass it back verbatim to page; never build or parse it.

## Errors

Map the MCP error to a clear, language-matched message: `401` → re-authorize (Claude Code / Codex run the OAuth redirect themselves; the matrix harness auto-refreshes the access token each run, so a persistent `401` means running `matrix login` again); `403` → missing scope (`plans:write` for writes) or another user's plan; `404` → not found; `422` → invalid field or insufficient pool; `429` → surface `Retry-After`.
