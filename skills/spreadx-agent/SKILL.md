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
| Estimate follower cost per speed | `estimate_follow_cost` (read-only) |
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
| Speed | the chosen preset's label (`标准`/`快速`/`爆发`) |
| Estimated completion | `eta_finish` (authoritative timestamp) → `≥24h`: `Ready in ~Nd (by <Mon D>)` / `<24h`: `Ready in ~Nh` |
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

| `speed` | Meaning (semantic) | Rate | Median/day |
|---|---|---|---|
| `standard` | human-like, natural pace | ~30–50/day | 40 |
| `boost` | same-day delivery | ~150–200/day | 175 |
| `turbo` | launch burst, front-loaded | ~400–500/day | 450 |

Render the label in the user's current language from the meaning above. Match the product UI for the two languages it ships — English uses `Standard` / `Boost` / `Turbo`; Chinese uses `标准` / `快速` / `爆发`. For any other language, translate the meaning naturally.

**Per-speed estimate columns.** When you ask the user to pick a speed, render the three presets as a comparison table. The **timeline differs by speed** (computed locally) and the **credit cost differs by speed too** (server-priced — there is no local formula):

- **Est. days** = `count ÷ median-per-day` (the table above), rounded; under 1 day → `<1`.
- **Est. completion (ETA)** = `< 24h` → `~Nh` (relative hours only, no date); `≥ 24h` → `~N.Nd` (nearest half-day) **plus an approximate calendar date** from today + est. days, e.g. `~5d (≈ Jul 5)`. Keep the duration primary and the `≈` date a parenthetical — a median estimate, not a commitment. The authoritative figure is the preview's `eta_finish` once a speed is picked.
- **Est. credits** = **per speed** from one `estimate_follow_cost({ count })` call — read `presets.standard` / `presets.boost` / `presets.turbo`. Credits are **not** speed-independent (e.g. turbo costs more than standard), so the three rows differ. One call returns all three presets; make it in parallel with `get_balance`.

Example menu for `count = 200`:

| Speed | Rate | Est. days | Est. completion | Est. credits |
|---|---|---|---|---|
| Standard | ~30–50/day | ~5 | ~5d (≈ Jul 5) | `presets.standard` |
| Boost | ~150–200/day | ~1 | ~27h (≈ Jul 1) | `presets.boost` |
| Turbo | ~400–500/day | <1 | ~11h | `presets.turbo` |

Pair the table with current/remaining credits from `get_balance` (e.g. `Current 1200 · Remaining …` against the chosen row).

**Choosing the preset — differs by tool:**

- **Followers (`create_follow_plan`)** — never guess. Use a preset *only* when the user explicitly named one of the three: a wire code (`standard`/`boost`/`turbo`) or its label (`Standard`/`Boost`/`Turbo`, `标准`/`快速`/`爆发`). In every other case — pace unstated, **or** a vague pace like "asap" / "尽快" / "慢慢来" / "fast" that isn't exactly one of the three — **stop and ask first**: render the three-preset comparison table (per *Per-speed estimate columns* above — days/ETA local, credits per speed from one `estimate_follow_cost` call) paired with `get_balance`, and have the user pick one. Only after they choose do you run the (real) `create_follow_plan` preview with the chosen `speed` to get the authoritative `eta_finish` + `confirmation_token` for the confirm dialog. Do not present the confirm dialog before the speed is resolved.
- **Engagement (`create_engagement_plan`)** — infer from intent: "asap"/"today"/"launch" → `boost`/`turbo`; "natural"/"slow" → `standard`. When pace is unstated, omit `speed` (defaults to `standard`). Add `speed` when the user signals urgency; no forced menu.

The preview's `eta_*` reflects the chosen speed, and the follower confirm dialog shows the Speed row.

## Flows

- **Balance** — call `get_balance`; report `points.balance`, `wallet_balance`, `package`.
- **Add followers** (e.g. "add 200 crypto English followers to @laura") — **resolve the speed first**: unless the user named one of the three presets (`standard`/`boost`/`turbo` or `标准`/`快速`/`爆发`), show the three-preset comparison table — each preset with **Rate · Est. days · Est. completion · Est. credits** (days/ETA computed locally from `count`; credits **per speed** from one `estimate_follow_cost({ count })` call) plus `get_balance` for current/remaining — and ask which to use; wait for the choice. Then preview with it — `create_follow_plan({ username: "laura", count: 200, tags: ["crypto","en"], speed: "<chosen>" })` → present the confirm dialog (incl. the **Speed** row) → on approval, repeat the call **with the preview's `confirmation_token`** → report `{ plan_id, status }`.
- **Engagement** (e.g. "like this tweet 50 times") — `create_engagement_plan({ tweet_url: "<url>", operations: [{ type: "like", count: 50 }] })` → preview → approval → repeat **with the preview's `confirmation_token`**. Add `speed` (same presets) when the user signals urgency.
- **Check plans** (e.g. "how are my campaigns doing", "list my plans") — `list_plans({ status_group?, target?, limit? })` returns a newest-first page (`plans[]` + `next_cursor`). Every row already carries progress (`total_items` / `completed_items` / `failed_items`), so summarize straight from the list — no per-plan fan-out. For one plan's detail, `get_plan({ plan_id })`. This is also the follow-up after a `create_*_plan` returns a `plan_id` (the "check status any time" loop).
  - `status_group` is one of `open | done | failed | cancelled | partial` (the server expands these, e.g. `open` → pending/executing/paused). Pass only these tokens; do not invent an `active`/`completed` taxonomy.
  - `target` filters by a Twitter handle. `next_cursor` is opaque — pass it back verbatim to page; never build or parse it.

## Errors

Map the MCP error to a clear, language-matched message: `401` → re-authorize (Claude Code / Codex run the OAuth redirect themselves; the matrix harness auto-refreshes the access token each run, so a persistent `401` means running `matrix login` again); `403` → missing scope (`plans:write` for writes) or another user's plan; `404` → not found; `422` → invalid field or insufficient pool; `429` → surface `Retry-After`.
