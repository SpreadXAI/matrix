---
title: SpreadX MCP tool-surface redesign — matrix (client) side
path: /docs/design/2026-06-28-tool-surface-redesign.md
audience: [agent, engineer]
topics: [mcp, tools, gate, skill]
status: ready
owner: milhous
---

# Tool-surface redesign — matrix (client) side

> **Two ends, one contract.** This spec is the **client/mirror** half. The
> **server/contract** half lives in `spreadx-platform`:
> [`docs/superpowers/specs/2026-06-28-tool-surface-redesign-design.md`](../../../spreadx-platform/docs/superpowers/specs/2026-06-28-tool-surface-redesign-design.md),
> which amends the canonical tool table in
> `spreadx-platform/docs/design/spreadx-mcp-user.md`. The contract (names,
> `inputSchema`/`outputSchema`, descriptions, scopes) is **owned by the server**;
> this repo only mirrors enough to gate, plus Skill phrasing, a dev mock, and docs.

## Why now (the whole argument)

**Update (2026-06-28): the server has shipped the two plan read tools.**
`spreadx-mcp-user` at HEAD now exposes `whoami` + **`get_plan`** + **`list_plans`**
(verified below against `mcp_user/tools/plans.py` + `app.py`). The server picked
**exactly the names this spec proposed**, so the matrix client is no longer doing
speculative pre-naming — it is **catching up to an already-shipped, frozen server
contract**. That makes the rename more urgent (the client still says
`get_plan_status`, which now no longer exists server-side) rather than less.

The remaining four business tools (`get_balance` / `list_orders` / `get_order` /
`create_*_plan`) are **still server-side unbuilt**, so locking *their* names here
still costs **zero** migration; locking them after the server builds them would cost
a rename across two repos plus any bound clients. Principle: **不向后兼容、只看长期
收益 / 稳定 / 性能、防过度设计.**

## Decision

Adopt the **7-tool** surface below (Approach A — minimal principled). Two real
smells in today's six are fixed; everything else is deliberately left alone.

| Tool | Kind | Scope | Gate (`capKey`/`countFrom`) | Δ |
|---|---|---|---|---|
| `get_balance` | read | `balance:read` | — | keep |
| `list_orders` | read | `orders:read` | — | keep |
| `get_order` | read | `orders:read` | — | keep |
| `list_plans` | read | `orders:read` | — | **NEW** |
| `get_plan` | read | `orders:read` | — | **RENAME** ← `get_plan_status` |
| `create_follow_plan` | write | `plans:write` | `follow` / `count` | keep |
| `create_engagement_plan` | write | `plans:write` | `engagement` / `operations` | keep |

Naming is now uniform: `get_<resource>` / `list_<resource>` / `create_<resource>_plan`.

### The two fixes
1. **`get_plan_status` → `get_plan`.** It returns the plan (with its progress);
   `get_<resource>` is the convention used by `get_order`/`get_balance`.
2. **Add `list_plans`.** Orders have `list`+`get`; plans had only `get`. After
   `create_*_plan` returns a `plan_id`, there was no way to enumerate plans —
   yet the product promises "check status any time". `list_plans` closes the
   list/get symmetry and the create→monitor loop. Keyset-paged, mirroring
   `list_orders`. Scope reuses `orders:read` — **no new scope** (avoids touching
   token issuance).

### Verified against shipped server code (2026-06-28)

The plan-read half of this surface is **no longer a proposal — it is live**.
Confirmed via codegraph against `spreadx-platform` HEAD:

| What the client mirrors | Shipped server symbol | Match |
|---|---|---|
| `get_plan(plan_id)` read · `orders:read` | `@mcp.tool("get_plan")` → `plan_tools.get_plan` (`mcp_user/app.py:157`) | ✓ name · kind · scope |
| `list_plans(status_group?, target?, cursor?, limit=20 ∈ 1..100)` read | `@mcp.tool("list_plans")` (`app.py:163`) | ✓ keyset · `limit` `Field(ge=1, le=100)` |
| `PlanSummary` projection | `class PlanSummary` (`mcp_user/tools/plans.py:26`) | ✓ field-for-field |

`PlanSummary` ships **exactly** this spec's projection: `plan_id, name, status,
target, total_items, completed_items, failed_items, scheduled_eta_at,
eta_completion_at, created_at`. Both tools enforce `orders:read` (`REQUIRED_SCOPE`,
`plans.py:23`) — **no `plans:read` scope was introduced**, as designed. The matrix
client therefore mirrors a frozen contract; **no further server coordination is
needed for these two** — the only open work is the client-side rename + add below.

## Matrix-side changes

Exhaustive — every reference found by grepping `get_plan_status` + the tool list.
Only **one** code file changes; the rest is docs/Skill.

- **`src/core/tools.ts`** (single source of truth — gate, `allowedTools`, mock all
  derive from it): in `TOOLS`, rename `get_plan_status`→`get_plan` and add
  `{ name: "list_plans", kind: "read" }`. Write metadata (`capKey`/`countFrom`)
  untouched. **This is the only code change.**
- **`skills/spreadx-agent/SKILL.md`**: intent→tool table — rename the "Plan
  progress" row to `get_plan`; add a row *"List my plans / how are they doing" →
  `list_plans`*.
- **`README.md`**: two spots — the "What's Inside" table (rename + add `list_plans`
  row) **and** the prose "Then check status (`get_plan_status`)" line.
- **`docs/usage.md`**: two spots — the gate-decision diagram's read-tool list, and
  the mock "Does not implement" list (rename `get_plan_status`→`get_plan`; `list_plans`
  is also un-mocked, so add it to that list).
- **`docs/design/spreadx-matrix.md`**: read-tool references at the gate-routing and
  not-in-scope lines (`get_plan_status`→`get_plan`; add `list_plans`).
- **Tests**: no test hardcodes tool names (they derive from `tools.ts`), so renames
  are assertion-safe. **No new gate logic** — reads route straight to `allow`. Run
  the suite; the only possible break is a `READ_TOOLS`/tool-count assertion, which
  goes 4→5 reads — fix the number if it fails.

### Not touched (avoid over-engineering)
- **`docs/superpowers/plans/2026-06-27-spreadx-matrix.md`** references
  `get_plan_status` 4× — it is a **historical as-built plan**, a record of what
  shipped. Rewriting history is churn; leave it.
- **Mock** stays `get_balance` + `create_follow_plan` only (below).

## Deliberately NOT changed (so a future dev doesn't "fix" it)

- **Two separate write tools.** Different caps + different input shapes (`count`
  vs `operations[]`). Merging into one `create_plan(kind)` pushes branching into
  the **gate** — the one place that must stay trivially auditable.
- **`confirm` boolean** as the dry-run→execute switch. The gate keys on it;
  splitting into `preview_*`/`commit_*` doubles the write surface for no gain.
- **`get_balance`** name, despite returning wallet+package too — it matches user
  vocabulary ("check my balance"), which an LLM-facing tool should optimize for.
- **Mock scope.** The mock stays `get_balance` + `create_follow_plan` only
  (existing decision: other tools are E2E-verified against staging, not mocked).
  `list_plans`/`get_plan` get registry + gate-routing coverage, not a mock — and
  since the server now ships both, that E2E path is **real today**, not pending.

## Drift guardrail (shipped 2026-06-28)

The contract above is **server-owned**; this repo only mirrors it. To keep the mirror
from drifting into a *phantom* (a tool the client names but the server doesn't expose),
CI runs a pure subset check — no network, no codegen, no schema framework:

- **`src/core/spreadx-tools.json`** — a vendored snapshot of the platform tool surface
  (8 sorted bare names; provenance + last-synced platform commit live in `docs/usage.md`).
- **`src/core/tools.guardrail.test.ts`** — asserts `registry ⊆ manifest` (the one that
  matters at runtime — gate, `allowedTools`, and mock all derive from `TOOLS`) and
  `skill ## Tools table ⊆ registry`, giving `skill ⊆ registry ⊆ manifest` transitively.
  It runs inside `pnpm test` under the repo's first CI workflow (`.github/workflows/ci.yml`).

**Adding a tool:** add it to `TOOLS` in `tools.ts` (the matrix-internal source of truth),
then ensure the name is in `spreadx-tools.json` (refresh by copying the platform
`tools.json`). The subset is **one-directional-safe** — matrix may lag the server, but
never reference a name it lacks. `whoami` stays in the manifest but **not** in `TOOLS`
(it's a platform identity tool, not an agent action), so `registry (7) ⊆ manifest (8)`
holds by design — do not add it to balance the counts.

## Out of scope

`outputSchema` rigor pass (this redesign is surface, not schema); scope-granularity
changes; the README "Phase B vs. contract" honesty note (tracked separately).
