# Execution Plan — MCP Auth Harness (matrix)

Implements `2026-06-28-mcp-auth-harness-design.md` (v2). TDD throughout: write/adjust the failing test first, then change code, then verify green. Runner: `npm test` (vitest). No backward compatibility required.

**Branch:** `feat/mcp-auth-harness` off `main`.

**Net effect:** matrix stops doing DCR and uses a baked `SPREADX_CLIENT_ID`; `discover` no longer needs/parses `registration_endpoint`; refresh path is unchanged. One jump comes for free from discovery.

---

## Phase 0 — Baseline

- [ ] `npm test` green on `main`; note current pass count.
- [ ] Create branch `feat/mcp-auth-harness`.

## Phase 1 — `oauth.ts`: purge registration (red → green)

**Test first (`src/auth/oauth.test.ts`):**
- [ ] In the `discover` test, **remove `registration_endpoint`** from the AS-metadata fixture and assert `discover` still resolves with `authorizationEndpoint`/`tokenEndpoint` (no throw, no `registrationEndpoint` field).
- [ ] Delete any `registerClient` test cases (function is being removed).

**Then code (`src/auth/oauth.ts`):**
- [ ] Delete `registerClient` (`:62-78`).
- [ ] Remove `registrationEndpoint` from `AsMetadata` (`:12`).
- [ ] In `discover`, stop reading/returning `registration_endpoint` (`:44`, `:57`).
- [ ] Keep `discover`'s S256 + `authorization_endpoint`/`token_endpoint` required checks.

**Verify:** `npm test src/auth/oauth.test.ts` green.

## Phase 2 — `login.ts`: baked client_id, no DCR (red → green)

**Test first (new `src/auth/login.test.ts`):** use the `fakeFetch` pattern from `oauth.test.ts` (records `calls`) + inject `openBrowser` and a `store` double.
- [ ] **No registration request:** assert no recorded call URL contains `register`.
- [ ] **Authorize URL carries the baked id:** capture the URL passed to `openBrowser`; assert `client_id=<SPREADX_CLIENT_ID>` and `code_challenge_method=S256`, `scope` includes `offline_access`, `resource=<mcpUrl>`.
- [ ] **Persists baked id:** drive the loopback callback (hit the redirect URI with `code`+`state`), assert `store.save` receives `clientId === SPREADX_CLIENT_ID` and the refresh token.
- [ ] **offline_access guard:** token response without `refresh_token` → login throws (keep `login.ts:96-98`).

**Then code (`src/auth/login.ts`):**
- [ ] Add `export const SPREADX_CLIENT_ID = process.env.SPREADX_CLIENT_ID ?? "<seeded-public-id>";` (constant near `SCOPE`).
- [ ] Drop the `registerClient` import; import nothing registration-related.
- [ ] In `runLoopbackFlow`: remove the `meta.registrationEndpoint` guard (`:31-33`) and the `registerClient` call (`:36`); set `const clientId = SPREADX_CLIENT_ID`.
- [ ] Leave `exchangeCode` + `store.save` as-is (they already persist `clientId`).

**Verify:** `npm test src/auth/login.test.ts` green.

## Phase 3 — Refresh path & full regression

- [ ] **No change to `resolve.ts`** — confirm `resolve.test.ts` stays green (refresh reads `creds.clientId`, now the baked id).
- [ ] `npm test` (full suite) green; pass count ≥ Phase 0 + new login tests.
- [ ] Typecheck: `npx tsc --noEmit` clean.
- [ ] Lint (if configured): `npx eslint src/auth` clean.

## Phase 4 — Wire the real client id & docs

- [ ] Replace `<seeded-public-id>` with the actual value once AS spec A6 seeds it (coordinate the exact string with the platform seed so staging+prod match). Until then, keep a clearly-marked placeholder and skip Phase 5.
- [ ] Update `docs/usage.md` / distribution notes: `matrix login` no longer self-registers; one fixed client id; existing users re-run `matrix login` once.

## Phase 5 — Land (gated on user)

- [ ] `git add` the changed `src/auth/*` + specs; commit `feat(auth): drop DCR, use pre-registered client_id (authorize-only harness)`.
- [ ] Push `feat/mcp-auth-harness`, open PR. **Do not merge** — depends on AS spec (seeded client id, `registration_endpoint` removed, `authorization_endpoint` = frontend). Note the cross-repo dependency in the PR body.

---

## Out of scope (do not add)
Device flow, back-channel authorize, `MatrixConfig.clientId` threading, `StoredCreds` schema change, `TokenStore` changes.

## Cross-repo sequencing
This harness PR is **safe to merge only after** the AS changes ship (otherwise discovery still advertises `registration_endpoint` and the seeded client id won't exist). Order: AS → (frontend ∥ matrix). Matrix can be written/reviewed in parallel but lands last.

## Verification summary (definition of done)
- `npm test` green incl. new `login.test.ts`; `tsc --noEmit` clean.
- No code path references `registerClient` / `registration_endpoint`.
- Authorize URL uses `SPREADX_CLIENT_ID`; refresh rotates with the stored id.
