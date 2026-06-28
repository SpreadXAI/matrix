# MCP Auth — Harness (matrix client)

- **Status:** Draft v2 (2026-06-28) — revised after full `src/auth` audit
- **Repo:** spreadx-matrix (`src/auth`)
- **Siblings:** `spreadx-platform` AS handoff spec, `spreadx-agent-fleet` consent-page spec.
- **Constraint:** no backward compatibility; long-term clarity/stability/security; prevent over-design. Follow mainstream CLI auth (gh / gcloud style).

## 1. Why

The harness must **only authorize, never register** — mainstream first-party CLIs ship a fixed pre-registered public `client_id` and run auth-code + PKCE + loopback. Today `src/auth/login.ts` does the opposite: it performs **Dynamic Client Registration** at runtime (`registerClient`) and hard-requires `meta.registrationEndpoint`.

With `authorization_endpoint` now pointing at the frontend (AS spec), the harness gets the **one-jump** flow for free: discovery returns the frontend URL, so `buildAuthorizeUrl` opens the browser straight onto the consent page. No special back-channel call is needed.

## 2. Current state (audited — full data flow)

- `login.ts`: `discover` → `runLoopbackFlow` (**requires `meta.registrationEndpoint`**, `login.ts:31`; calls `registerClient`, `login.ts:36`) → `exchangeCode` → `store.save`.
- **`clientId` is persisted.** `store.save` writes `clientId` into `StoredCreds` (`tokenStore.ts:8`), and **`resolve.ts:38` reuses `creds.clientId` for refresh.** So the client id flows login → storage → refresh. Any change to how the id is obtained must keep this path consistent.
- `oauth.ts`: `discover` parses + returns `registration_endpoint` (`oauth.ts:44,57`); `AsMetadata.registrationEndpoint?` (`:12`); `registerClient` (`:62`). `buildAuthorizeUrl`, `exchangeCode`, `refresh` are generic and stay.
- `SCOPE = "balance:read orders:read plans:write offline_access"` (`login.ts:9`).
- `config.ts` (`MatrixConfig`) has **no** client-id field; `mcpUrl` comes from `SPREADX_MCP_URL`.
- Tests: `oauth.test.ts` covers `buildAuthorizeUrl`; `resolve.test.ts` covers refresh. `registerClient` and `runLoopbackFlow` have **no** covering tests (so removing `registerClient` breaks nothing).

## 3. Changes (gap-by-gap)

| # | Change | File |
|---|--------|------|
| M1 | **Drop DCR.** Remove the `meta.registrationEndpoint` guard (`login.ts:31-33`) and the `registerClient` call (`login.ts:36`); obtain `clientId` from the baked constant instead. | `login.ts` |
| M2 | **Baked-in pre-registered `client_id`.** Add a single module constant `SPREADX_CLIENT_ID` (public, not secret — like `gh`), with an optional `process.env.SPREADX_CLIENT_ID` override for custom deployments. Used in `runLoopbackFlow`/`buildAuthorizeUrl`. | `login.ts` (+ small constant) |
| M3 | **Purge registration from `oauth.ts`:** delete `registerClient`; remove `registrationEndpoint` from `AsMetadata`; **and stop parsing/returning `registration_endpoint` in `discover`** (`oauth.ts:44,57`). `discover` must not require it. | `oauth.ts` |
| M4 | **Persist the baked id.** `login` writes `SPREADX_CLIENT_ID` into `StoredCreds.clientId`; `resolve.ts` is **unchanged** (it keeps refreshing with `creds.clientId`). Keep the `clientId` field in `StoredCreds` — no schema change — to minimise blast radius. | `login.ts` (no `resolve.ts`/store change) |
| M5 | **One jump = discovery.** No code change beyond M1–M3: `discover` returns `authorizationEndpoint` = the frontend page, so `buildAuthorizeUrl` opens the browser directly onto consent. | — |
| M6 | **Keep unchanged:** PKCE S256, loopback server + `state` CSRF check, `exchangeCode`, `refresh` rotation, `TokenStore` (keychain/file), the `offline_access` refresh-required guard (`login.ts:96-98`). | — |

`SCOPE` keeps `offline_access` (depends on AS PR #590 advertising/granting it).

## 4. Resulting flow

```
matrix → discover (RFC 9728 → 8414) → authorizationEndpoint = https://app.spreadx.ai/.../oauth/authorize
       → loopback server on 127.0.0.1:<port>
       → openBrowser(buildAuthorizeUrl{ SPREADX_CLIENT_ID, loopback redirect_uri, S256 challenge, SCOPE, state, resource })
                                                            ← ONE jump: browser lands on consent page
       (user logs in / registers / consents on the frontend)
       → loopback /callback?code&state  → exchangeCode → access + refresh → store.save (clientId = SPREADX_CLIENT_ID)
later: resolveAccessToken → refresh with creds.clientId (= SPREADX_CLIENT_ID), rotating refresh token
```

## 5. Provisioning & no-backward-compat notes

- **One client_id, seeded in every AS env.** `SPREADX_CLIENT_ID` must be seeded identically in **staging and prod** AS DBs (AS spec A6), with loopback `redirect_uris` + the matrix scope. One constant covers both; the env override is only for ad-hoc deployments.
- **Existing logins must re-auth.** With `/oauth/register` and DCR clients removed (AS spec), old DCR-issued `clientId`s in stored creds will stop refreshing → users run `matrix login` once. Acceptable under the no-backward-compat constraint; surface a clear "run matrix login" error (already produced by `resolve.ts:28`).

## 6. Out of scope (anti-over-design)

Device Authorization Grant (no headless requirement), a back-channel `{authorization_url}` fetch (unnecessary once `authorization_endpoint` = frontend), confidential-client/secret handling, threading `client_id` through `MatrixConfig` (a module constant + env override is enough), and any change to `TokenStore` backends or the `StoredCreds` schema.

## 7. Testing

- `login` runs with the **baked client_id and makes no registration request** — inject `fetchFn`; assert no call to any `register` endpoint and that the authorize URL carries `SPREADX_CLIENT_ID`. (Adds the missing `runLoopbackFlow`/`login` coverage.)
- `discover` succeeds against metadata **without `registration_endpoint`** (no throw; `registrationEndpoint` field gone).
- `buildAuthorizeUrl` targets the frontend `authorizationEndpoint`; loopback captures `code`, validates `state`, rejects on mismatch.
- `exchangeCode` → access + refresh persisted with `clientId = SPREADX_CLIENT_ID`; `resolve` refresh still rotates using the stored id (existing `resolve.test.ts` stays green).
- Existing keychain/file `TokenStore` tests unaffected.

## 8. Dependencies

AS spec: matrix `SPREADX_CLIENT_ID` seeded (loopback redirect_uris + scope), `authorization_endpoint` = frontend, `registration_endpoint` removed, `offline_access` advertised (PR #590). Confirm the exact authorize route (locale) so the seeded redirect/issuer and discovery line up.
