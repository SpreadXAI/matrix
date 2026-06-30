---
name: spreadx-agent
description: Operates a user's SpreadX account via the spreadx MCP tools — balance, orders, plans, add followers, like/retweet/comment. Use when the user asks to check balance or points, view orders, list their plans or campaigns, add followers to @x, like a tweet, or check how a plan is progressing.
---

# SpreadX Agent skill

Translate natural-language asks into `mcp__spreadx__*` tool calls. Always preview a write before committing it, and respond in the user's own language. Each tool's exact parameters live in its own MCP description/schema — rely on those rather than guessing; this skill covers *when* and *in what order* to call the tools, and how to handle the results.

## Preflight — tools must be present (fail fast, never spelunk)

These tools only exist if the `spreadx` MCP server connected. **If no `mcp__spreadx__*` tool is available in this session, STOP and ask the user to authorize — do not investigate.** Specifically:

- **Do NOT** inspect local files, `~/.codex`/`~/.claude` directories, SQLite databases, the keychain, or process strings hunting for tokens or config. That is always wrong and wastes the session.
- **Do NOT** spawn sub-runs / `codex exec` to "discover" the tools — a missing tool layer won't appear by retrying.
- The cause is almost always **OAuth not valid at session start**. MCP clients attach server tools **when the session starts**, so a mid-session login does not retro-attach them.

Tell the user (in their language) the one fix that works:

> SpreadX isn't authorized yet (or the login expired). Run `codex mcp login spreadx` (include the `offline_access` scope), then **restart the Codex session** — tools only load at session start. Claude Code users: the first tool call triggers the browser OAuth automatically; if it doesn't, reopen the session. Still stuck? Use the standalone harness: `pnpm harness "Check my balance"`.

Once any `mcp__spreadx__*` tool is present, proceed normally — no further auth prompts. (A `401` *during* a call is the separate re-authorize case in **Errors** below.)

## Tools (all named `mcp__spreadx__<name>`)

| Intent | Tool |
|---|---|
| Balance / points / package | `get_balance` (read-only) |
| List orders | `list_orders` (read-only) |
| One order | `get_order` (read-only) |
| List my plans / how are they doing | `list_plans` (read-only) |
| One plan's progress | `get_plan` (read-only) |
| Estimate follower credits, no target yet (credits only, no ETA) | `estimate_follow_cost` (read-only) |
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

**Engagement boost** (target is a tweet): same credits rows, but the target row is **Tweet** (`operations[].target`), listing each op as `type × count` (e.g. like × 50), and the speed row reads **Curve** — the chosen engagement preset's label (`viral_burst` / `natural_growth` / `sustained_heat`), not a rate.

Fetch Current credits via `get_balance` and compute Remaining yourself; the preview carries no balance. If `get_balance` is unavailable, show Estimated only and say the balance check was skipped.

### Shortfall bands

Compute `pct = shortfall / requested × 100` for each operation, then act on the worst band:

| Band | Meaning | Default action |
|---|---|---|
| `≤5%` | pool is sufficient; the gap is negligible | proceed to commit with the preview's `confirmation_token`, same count |
| `5–10%` | pool is slightly tight | ask whether to proceed, or lower the count to match the pool |
| `>10%` | pool is insufficient | do not proceed — offer to lower the count or relax `tags`. The server also rejects a commit above 10%. |

### Speed presets

The two write tools use **separate** speed vocabularies — followers pick a delivery *rate*, engagement picks a delivery *curve*. In both, the code is sent verbatim as `speed`; only the *label* shown to the user is translated.

**Followers (`create_follow_plan`)** take `speed` (default `standard`) — one of three rate presets that collapse delivery pace into a single choice. The server rejects any other value. **`standard` / `boost` / `turbo` are wire codes: send them verbatim, never translated.**

| `speed` | Meaning (semantic) | Rate |
|---|---|---|
| `standard` | human-like, natural pace | ~30–50/day |
| `boost` | same-day delivery | ~150–200/day |
| `turbo` | launch burst, front-loaded | ~400–500/day |

Render the label in the user's current language from the meaning above. Match the product UI for the two languages it ships — English uses `Standard` / `Boost` / `Turbo`; Chinese uses `标准` / `快速` / `爆发`. For any other language, translate the meaning naturally.

**Per-speed estimate columns.** When you ask the user to pick a speed, both the **completion time and the credits come from the server**, never from a local formula. Run `create_follow_plan` as a **dry-run preview** (no `confirmation_token`) once per speed — `standard`, `boost`, `turbo` — in parallel, alongside `get_balance`, then read each preview's authoritative fields:

- **Est. completion (ETA)** = format that preview's `eta_finish` with the **same rule as the confirm dialog** — `< 24h` → `~Nh`; `≥ 24h` → `~Nd (by <Mon D>)`. Because the menu and the confirm dialog both read the *same* `eta_finish` field, the two can never disagree.
- **Est. credits** = that preview's `points_cost_estimate` (per speed; turbo costs more than standard, so the rows differ).
- **Rate** = the descriptive `Rate` column from the speed table above (informational only — do not turn it into an ETA).
- Keep each preview's `confirmation_token`: the speed the user picks already has a valid preview, so reuse it for the confirm dialog and commit (re-preview only if the token is later rejected as stale).

**Do not compute ETA locally from `count ÷ rate`.** That ignores the server's minimum natural-delivery window, which dominates at low counts: a small plan (e.g. 10 follows) finishes at roughly the same wall-clock time on all three speeds — the window, not throughput, binds — so a local formula would falsely show `turbo` finishing ~9× sooner than `standard` and mislead the user into paying for speed that buys no time. `count ÷ rate` only approximates the server once `count` is large enough that throughput exceeds the window, and even then the preview's `eta_finish` is authoritative.

Example menu for `count = 200` (every value below is read from that speed's dry-run preview, not computed):

| Speed | Rate | Est. completion (`eta_finish`) | Est. credits (`points_cost_estimate`) |
|---|---|---|---|
| Standard | ~30–50/day | ~5d (by Jul 5) | … |
| Boost | ~150–200/day | ~27h (by Jul 1) | … |
| Turbo | ~400–500/day | ~11h | … |

Pair the table with current/remaining credits from `get_balance` (e.g. `Current 1200 · Remaining …` against the chosen row).

**Engagement (`create_engagement_plan`)** — `speed` selects a delivery **curve** over a fixed ~48h window (NOT a daily rate). Default `natural_growth`.

| `speed` | Curve (when delivery lands) | Best for |
|---|---|---|
| `viral_burst` | front-loaded: ~40% in first 30m, tapering across 48h | launch spike / breaking moment |
| `natural_growth` *(default)* | balanced ramp, peak at 1–6h, across 48h | organic-looking default |
| `sustained_heat` | even all-day presence across 48h | steady visibility / long campaigns |

Engagement **cost does not change with speed** (cost is per op type, not per curve); all three curves finish within ~48h. Speed selects the *shape* of delivery only.

**Engagement menu columns.** Like the follower menu, show **Est. completion** and **Est. credits**. Both are the **same for every curve**: completion is the fixed **~48h** window, and credits are per-op-type, so the curve never changes them. Render **Est. credits as the per-op breakdown** that sums to the total — `like 10×<count> + comment 30×<count> + retweet 15×<count> + bookmark 10×<count> (+ quote 20×<count>) = total`, including only the ops present (per-op rates: `like` 10 · `retweet` 15 · `comment` 30 · `bookmark` 10 · `quote` 20 credits). Get the authoritative total from **one** `create_engagement_plan` dry-run (no `confirmation_token`) run with `get_balance`; `~48h` needs no preview. The menu's real choice is the delivery **shape** — the two columns just show finish time + cost up front.

Example menu for `like × 50 + comment × 10 + retweet × 10` (Est. credits identical across curves):

| Curve | When delivery lands | Est. completion | Est. credits |
|---|---|---|---|
| Viral burst | front-loaded: ~40% in first 30m | ~48h | like 10×50 + comment 30×10 + retweet 15×10 = 950 |
| Natural growth *(default)* | balanced ramp, peak at 1–6h | ~48h | like 10×50 + comment 30×10 + retweet 15×10 = 950 |
| Sustained heat | even all-day presence | ~48h | like 10×50 + comment 30×10 + retweet 15×10 = 950 |

Pair with `get_balance` (e.g. `Current 1200 · Remaining 250`). Est. completion / Est. credits are identical across rows — only the *shape* differs.

**Choosing the preset — differs by tool:**

- **Followers (`create_follow_plan`)** — never guess. Use a preset *only* when the user explicitly named one of the three: a wire code (`standard`/`boost`/`turbo`) or its label (`Standard`/`Boost`/`Turbo`, `标准`/`快速`/`爆发`). In every other case — pace unstated, **or** a vague pace like "asap" / "尽快" / "慢慢来" / "fast" that isn't exactly one of the three — **stop and ask first**: render the three-preset comparison table (per *Per-speed estimate columns* above — ETA + credits both read from a per-speed `create_follow_plan` dry-run preview) paired with `get_balance`, and have the user pick one. The chosen speed's preview already carries the authoritative `eta_finish` + `confirmation_token`, so reuse it for the confirm dialog — no second preview needed (re-preview only if the token is later rejected as stale). Do not present the confirm dialog before the speed is resolved.
- **Engagement (`create_engagement_plan`)** — never guess. When the user explicitly named one of the three (`viral_burst` / `natural_growth` / `sustained_heat`, or a translated label), preview **that** curve and go straight to confirm. Otherwise — pace unstated, or a vague signal ("asap" / "尽快" / "spread it out") that isn't exactly one of the three — **show the curve menu first** with the **Est. completion / Est. credits** columns filled from one default-`natural_growth` dry-run (no `confirmation_token`, `get_balance` alongside; the two columns are identical across curves — see *Engagement menu columns* above), and wait for the pick. Because cost is curve-independent, **never** preview per curve up front; reuse the default preview's `confirmation_token` if the pick is `natural_growth`, otherwise run one more dry-run with the picked curve to mint a matching token (cost unchanged). Do not present the confirm dialog before the speed is resolved.

The follower confirm dialog shows the Speed row; the engagement confirm dialog shows a Curve row.

## Flows

- **Balance** — call `get_balance`; report `points.balance`, `wallet_balance`, `package`.
- **Add followers** (e.g. "add 200 crypto English followers to @laura") — **resolve the speed first**: unless the user named one of the three presets (`standard`/`boost`/`turbo` or `标准`/`快速`/`爆发`), show the three-preset comparison table — each preset with **Rate · Est. completion · Est. credits**, where completion and credits are read from a per-speed `create_follow_plan` dry-run preview (`eta_finish` + `points_cost_estimate`), the three previews run in parallel with `get_balance` for current/remaining — and ask which to use; wait for the choice. The chosen speed's preview already carries the authoritative `eta_finish` + `confirmation_token`, so go straight to the confirm dialog (incl. the **Speed** row) → on approval, commit by repeating the call **with that `confirmation_token`** → report `{ plan_id, status }`. (If the user named a preset up front, run that single preview and skip the menu.)
- **Engagement** (e.g. "like this tweet 50 times") —
  1. **Gather**: `tweet_url` + `operations[]` (each `{ type, count }`).
  2. **Resolve speed** — one dry-run preview yields the authoritative Est. credits + `confirmation_token`:
     - **Named** (`viral_burst` / `natural_growth` / `sustained_heat`): run one `create_engagement_plan({ tweet_url, operations: [...], speed: "<named>" })` dry-run (no `confirmation_token`) + `get_balance`, then skip to step 3.
     - **Unnamed**: run one dry-run with default `speed: "natural_growth"` + `get_balance`, render the curve menu with the **Est. completion (~48h) / Est. credits** columns (from that preview, identical across curves), and **wait** for the pick. If the pick is `natural_growth` reuse its token; otherwise run one more dry-run with the picked curve for a matching token (cost unchanged).
  3. **Confirm**: show the **Engagement boost** dialog (Tweet target; each op as `type × count`; a **Curve** row = chosen preset label; Cost = Est. credits breakdown `like 10×n + comment 30×n + … = total`; Current credits; Remaining = `get_balance` − cost) → on approval, commit by repeating the call **with the picked curve's `confirmation_token`** → report `{ plan_id, status }`.
- **Check plans** (e.g. "how are my campaigns doing", "list my plans") — `list_plans({ status_group?, target?, limit? })` returns a newest-first page (`plans[]` + `next_cursor`). Every row already carries progress (`total_items` / `completed_items` / `failed_items`), so summarize straight from the list — no per-plan fan-out. For one plan's detail, `get_plan({ plan_id })`. This is also the follow-up after a `create_*_plan` returns a `plan_id` (the "check status any time" loop).
  - `status_group` is one of `open | done | failed | cancelled | partial` (the server expands these, e.g. `open` → pending/executing/paused). Pass only these tokens; do not invent an `active`/`completed` taxonomy.
  - `target` filters by a Twitter handle. `next_cursor` is opaque — pass it back verbatim to page; never build or parse it.

## Errors

Map the MCP error to a clear, language-matched message: `401` → re-authorize (Claude Code / Codex run the OAuth redirect themselves; the matrix harness auto-refreshes the access token each run, so a persistent `401` means running `matrix login` again); `403` → missing scope (`plans:write` for writes) or another user's plan; `404` → not found; `422` → invalid field or insufficient pool; `429` → surface `Retry-After`.
