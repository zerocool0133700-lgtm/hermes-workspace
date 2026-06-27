# Hermes Workspace → Central IdP — Login Delegation (Phase 1b)

**Date:** 2026-06-27
**Status:** Approved design — pending implementation plan
**Author:** Dave + Claude (brainstorming session)
**Scope:** Phase 1b of the consolidation: make **hermes-workspace** delegate interactive login to the central Ellie IdP (`ellie-idp`, `:3006`). **Login only** — keep the existing opaque session token; just swap the password gate for an IdP redirect+callback. Record the authenticated `userId` in the session.

---

## 1. Context & Goal

The central IdP (Phase 1, Ellie Rust on `:3006`) issues HS256 access JWTs (claim `userId` = `life_users.id`, plus `email,role,privileges,aud,jti,iss:"ellie-idp",iat,exp`) signed with the shared `LIFE_JWT_SECRET`, via a CSRF-safe one-time-code login (`GET /login?redirect_uri=&state=&aud=` → `POST /auth/exchange {code}` → `{access_token}`). Proving Ground delegated its login in Phase 1a (login-only). This phase does the same for hermes-workspace.

**hermes-workspace today** (`src/server/auth-middleware.ts`): a **single shared password** (`HERMES_PASSWORD`/`CLAUDE_PASSWORD`) gates an **opaque session token** (`randomBytes(32).toString("hex")`), stored in-memory (`Map<token, expiry>`) + a file (`~/.hermes/workspace-sessions.json`), 30-day TTL, cookie `claude-auth` (HttpOnly; Secure-prod; SameSite=Strict; Path=/). The single choke point is `isAuthenticated(request)` → `isValidSessionToken(token)`. **No users, no database** — it is identity-less single-user.

**Goal:** replace the password login with **delegated login** to the IdP, keeping hermes-workspace's own opaque session model. On callback, exchange the code, verify the IdP JWT, and mint the **existing** opaque session token — recording the IdP `userId`/`email` in the session entry. Per-request auth is otherwise unchanged.

### Why this is the simplest of the three integrations
- **No users / no DB / no migration / no JIT provisioning / no FK reconciliation** (unlike Proving Ground).
- **No confused-deputy concern** — hermes session tokens are opaque random strings, not JWTs, so the shared `JWT_SECRET` can't be replayed as a hermes session. The IdP JWT is verified exactly once, at the callback.
- **No IdP-side prerequisite** — hermes-workspace's origin `http://localhost:3302` is already in the IdP `redirect_allowlist`, and the IdP already emits per-`aud` claims. (Phase 1a needed an IdP allowlist PR; this one does not.)

---

## 2. Decisions (locked)

1. **Login only:** keep the opaque session token + `isAuthenticated`/`isValidSessionToken` + the `claude-auth` cookie. Only the login entry-point changes.
2. **Record identity:** extend the session store value from `expiry` to `{ expiry, userId?, email? }`. Nothing consumes it yet; it future-proofs per-user features. Legacy/password entries simply have no identity.
3. **Server-side callback** at `GET /api/auth/callback`; the frontend change is just a "Sign in with Ellie" button.
4. **No per-request JWT validation** — the IdP JWT is verified only at the callback (`verifyIdpToken`); per-request stays opaque-token.
5. **`authRequired` fix:** `authRequired = isPasswordProtectionEnabled() || AUTH_IDP_ENABLED`. Enabling the IdP must require auth even when no legacy password is set (otherwise the app would be wide open).
6. **Feature-flagged rollout** `AUTH_IDP_ENABLED` (default false); password login retained as the off-state fallback. When on, `POST /api/auth` (password) returns 403 and the UI hides the password form.
7. **Shared secret in plain env** (`JWT_SECRET` = `LIFE_JWT_SECRET`) — hermes-workspace has no Hollow vault.

---

## 3. Architecture & Flow

```
 Browser (hermes-workspace, :3302)            IdP (:3006)        hermes server (same origin)
   │  "Sign in with Ellie" → GET /api/auth/idp-login ──────────────────────▶│ set hermes_idp_state cookie
   │  ◀──────────────── 302 to IdP /login ─────────────────────────────────┤
   ├─ 302 ─────────────────────────────────▶ /login?redirect_uri=<cb>&state=&aud=hermes
   │                                  (password + TOTP at IdP)               │
   │  ◀──────── 302 redirect_uri?code=&state= ────────┤                      │
   ├─ GET /api/auth/callback?code=&state= ───────────────────────────────────▶│ verify state cookie
   │                                                  │◀── POST /auth/exchange │ (server→server, 5s timeout)
   │                                                  │ {code} → {access_token}│
   │                                                  │   verifyIdpToken()     │ iss/aud/exp+skew
   │                                                  │   storeSessionToken(   │ {expiry,userId,email}
   │  ◀──────── 302 "/" + Set-Cookie claude-auth ────────────────────────────┤ clear state cookie
   │  (from here: normal opaque-token session — isAuthenticated unchanged)    │
```

- `aud=hermes` end-to-end. The `state` (CSRF on the callback) lives in a short-lived `hermes_idp_state` cookie and complements the IdP's atomic one-time code.
- The `redirect_uri` origin is hermes-workspace's own origin (single-port SSR); it must be IdP-allowlisted (`:3302` already is).

---

## 4. Components & Changes

### 4.1 `src/server/idp.ts` (new)
- `idpLoginUrl(state: string, origin: string): string` — `${IDP_BASE_URL}/login?redirect_uri=${origin}/api/auth/callback&state=${state}&aud=${IDP_AUD}`.
- `verifyIdpToken(token: string): Promise<{ userId: string; email?: string; role?: string }>` — `jose` `jwtVerify` with the shared secret; require `iss="ellie-idp"` + `aud=IDP_AUD`; `clockTolerance: 30`; `exp` enforced; failure → throw.
- `exchangeCode(code: string): Promise<string>` — `POST ${IDP_BASE_URL}/auth/exchange {code}`, 5s `AbortController` timeout, one retry on 5xx/network (not 4xx); returns `access_token`.
- Reads `IDP_BASE_URL` (default `http://127.0.0.1:3006`), `IDP_AUD` (default `hermes`), and the shared secret from `JWT_SECRET`.
- Adds the `jose` dependency (hermes-workspace currently uses node `crypto` for its opaque tokens; `jose` is the standard for HS256 JWT verify and matches the IdP/PG).

### 4.2 Server routes (TanStack Start `createFileRoute(... { server:{ handlers } })`)
- **`src/routes/api/auth/idp-login.ts` (GET):** generate `state`, set `hermes_idp_state` cookie (§5), 302 to `idpLoginUrl(state, origin)`. Rate-limited (reuse the per-IP limiter pattern already used by `/api/auth`).
- **`src/routes/api/auth/callback.ts` (GET):** read `code`+`state` + the `hermes_idp_state` cookie; if missing/mismatch → clear state + redirect to `/?login_error=idp_state` (or 400). Else `exchangeCode` → `verifyIdpToken` → claims → `storeSessionToken(token, { userId, email })` → set `claude-auth` cookie + clear state cookie → 302 `/`. Any exchange/verify failure → clear state + redirect `/?login_error=idp`, no session.

### 4.3 `src/server/auth-middleware.ts`
- Session value type: `Map<string, number>` → `Map<string, { expiry: number; userId?: string; email?: string }>`. Update `storeSessionToken`, `isValidSessionToken`, the file (de)serialization, and the prune sweep accordingly. **Backward-compatible:** loading an old file (values were `expiry` numbers, or entries lacking `userId`) must still work — coerce/handle missing identity.
- `storeSessionToken(token, identity?: { userId; email })` — optional identity; password login passes none.
- `authRequired` logic: expose/compute `authRequired = isPasswordProtectionEnabled() || authIdpEnabled()` where `authIdpEnabled()` reads `AUTH_IDP_ENABLED`. `isAuthenticated` short-circuits to `true` only when **neither** password protection **nor** IdP is enabled.

### 4.4 `/api/auth-check` (`src/routes/api/auth-check.ts`)
- Add `idpEnabled: boolean` (from `AUTH_IDP_ENABLED`) to the response, alongside the existing `authenticated`/`authRequired`. The LoginScreen already calls this on mount — no new config endpoint needed. `authRequired` reflects the §4.3 fix.

### 4.5 `POST /api/auth` (`src/routes/api/auth.ts`)
- When `AUTH_IDP_ENABLED` is on, return **403** (`{ ok:false, error:"Password login disabled; use the IdP" }`) before verifying the password. Code retained for the off-state.

### 4.6 Login UI (`src/components/auth/login-screen.tsx`)
- Read `idpEnabled` from the auth-check status (already fetched by the root layout). When true, render a single **"Sign in with Ellie"** button → `window.location.href = "/api/auth/idp-login"`; hide the password form. When false → today's password form unchanged.

### 4.7 Config (`.env.example` + reads)
- Add `AUTH_IDP_ENABLED` (default false), `IDP_BASE_URL` (default `http://127.0.0.1:3006`), `JWT_SECRET` (= the IdP's `LIFE_JWT_SECRET`), `IDP_AUD` (default `hermes`). Read via `process.env` (no config module / no Hollow).

---

## 5. Security

- **State cookie** `hermes_idp_state`: `HttpOnly; SameSite=Lax; Secure(prod); Path=/api/auth/callback; Max-Age=300`. Value = `randomBytes(32).toString("hex")`. Checked `cookieState === urlState` at the callback; cleared (`Max-Age=0`) on success and failure. (Note: the existing session cookie uses `SameSite=Strict`, but the state cookie must be `Lax` so it survives the top-level redirect back from the IdP.)
- **JWT verify:** `iss="ellie-idp"` + `aud=IDP_AUD` + signature + `exp` (±30s skew). Never trust before verify; never persist the IdP JWT (only the opaque session token is stored).
- **Code exchange** server-to-server, 5s timeout; the one-time code is single-use at the IdP.
- **No token in any URL** beyond the one-time `code`.
- **Opaque session unchanged:** `claude-auth` stays HttpOnly/Secure-prod; per-request validation unchanged → no new attack surface and no confused-deputy (opaque, not JWT).
- **`authRequired` fix (§4.3)** prevents an open app when the IdP is enabled without a legacy password.
- **Rollback:** `AUTH_IDP_ENABLED=false` restores password login with no code removal.

---

## 6. Testing (vitest)

- `verifyIdpToken`: accepts a correctly-signed `iss=ellie-idp`/`aud=hermes` token; rejects wrong `aud`, wrong `iss`, wrong secret, expired-beyond-skew; accepts within ±30s.
- `idpLoginUrl`: contains `redirect_uri=<origin>/api/auth/callback`, the `state`, and `aud=hermes`.
- `exchangeCode`: 5s timeout; one retry on 5xx/network; no retry on 4xx; throws on missing `access_token` (network path stubbed).
- **callback handler:** happy path (valid code → stubbed exchange/verify → `claude-auth` cookie set → `state` cleared → 302 `/`; the minted session records `userId`); bad/missing `state` → no session, redirect with error; exchange/verify throw → no session, redirect with error.
- **session store:** `storeSessionToken` with identity round-trips through `isValidSessionToken` + the file; an old-format session file (no `userId`) still loads and validates (backward-compat).
- **auth gating:** with `AUTH_IDP_ENABLED=true` and no `HERMES_PASSWORD`, `isAuthenticated` returns false for an unauthenticated request (the §4.3 fix); `/api/auth-check` reports `authRequired:true, idpEnabled:true`.
- **flag off:** password login still works (`POST /api/auth` succeeds with the right password); with flag on it returns 403.

---

## 7. File Touchpoints (current code)

- `src/server/auth-middleware.ts` — session store value + `storeSessionToken` + `isAuthenticated`/`authRequired` (the choke point at ~254-269).
- `src/server/idp.ts` (new) — IdP helpers.
- `src/routes/api/auth/{idp-login,callback}.ts` (new).
- `src/routes/api/auth-check.ts` — add `idpEnabled`.
- `src/routes/api/auth.ts` — flag-gate the password POST.
- `src/components/auth/login-screen.tsx` — "Sign in with Ellie" button.
- `.env.example` — new vars. `package.json` — add `jose`.
- Unchanged: `claude-auth` cookie mechanics, `__root.tsx` / `-root-layout-state.ts` (they already key off `authRequired`/`authenticated` from auth-check).

---

## 8. Out of Scope (deferred)

Per-request JWT validation (keep opaque tokens); multi-user / per-user features built on the recorded `userId`; a logout endpoint (none exists today; `revokeSessionToken` is present but unexposed); removing password login; surfacing the IdP identity in the UI (an `/api/auth/me`).

---

## 9. Notes

1. **No IdP change required** — `:3302` is already allowlisted and per-`aud` emission exists. If hermes-workspace is deployed on a different origin, add it to the IdP's `IDP_REDIRECT_ALLOWLIST`.
2. **Secret distribution** — `JWT_SECRET` must equal the IdP's `LIFE_JWT_SECRET`; set it in hermes-workspace's `.env` (gitignored).
3. **`SameSite` nuance** — the durable `claude-auth` cookie keeps `SameSite=Strict`; only the short-lived `hermes_idp_state` cookie is `Lax` (required to survive the IdP round-trip).
