# Hermes Workspace IdP Login Delegation — Phase 1b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hermes-workspace delegate interactive login to the central Ellie IdP (`:3006`) — keeping its existing opaque session token, just swapping the password gate for an IdP redirect+callback, and recording the authenticated `userId`/`email` in the session.

**Architecture:** A "Sign in with Ellie" button hits `GET /api/auth/idp-login` (sets a CSRF `state` cookie, 302s to the IdP). The IdP redirects back to `GET /api/auth/callback`, which exchanges the one-time code server-to-server, verifies the IdP JWT (shared `JWT_SECRET`), then mints hermes-workspace's **existing** opaque session token (recording identity) and sets the existing `claude-auth` cookie. Per-request auth (`isAuthenticated`/`isValidSessionToken`) is unchanged — still opaque tokens, so no confused-deputy concern.

**Tech Stack:** TypeScript, TanStack Start (`createFileRoute(... { server:{ handlers } })`), Node `crypto`, `jose` (HS256 verify — new dep), `vitest` (colocated `*.test.ts`), pnpm. Single-origin SSR (dev `:3302`). Repo: the fork `zerocool0133700-lgtm/hermes-workspace`; branch/worktree `feat/idp-login`.

## Global Constraints

- Login only; keep the opaque session token + `isValidSessionToken` + the `claude-auth` cookie. Only the login entry-point changes.
- IdP JWT trusted ONLY at the callback via `verifyIdpToken` (`iss:"ellie-idp"` + `aud:IDP_AUD` + `clockTolerance:30`). No per-request JWT validation.
- Record identity: session store value becomes `{ expiry, userId?, email? }`, backward-compatible with old `number`-valued files.
- `authRequired = isPasswordProtectionEnabled() || isIdpEnabled()`. `isAuthenticated` returns `true` only when NEITHER is enabled. (Enabling the IdP must require auth even with no legacy password.)
- State cookie `hermes_idp_state`: `HttpOnly; SameSite=Lax; Secure(prod); Path=/api/auth/callback; Max-Age=300`. (The durable `claude-auth` cookie stays `SameSite=Strict`; the state cookie must be `Lax` to survive the IdP redirect.)
- `exchangeCode`: 5s timeout, one retry on 5xx/network, none on 4xx.
- Feature flag `AUTH_IDP_ENABLED` (default false); password login retained for the off-state; when on, `POST /api/auth` returns 403.
- Shared secret in plain env: `JWT_SECRET` (= the IdP's `LIFE_JWT_SECRET`); `IDP_BASE_URL` (default `http://127.0.0.1:3006`); `IDP_AUD` (default `hermes`).
- No IdP-side change (`:3302` already allowlisted; per-`aud` emission exists). No users, no DB, no migration.
- Test command: `pnpm vitest run <file>` (deps installed via `pnpm install`).

---

## File Structure

**Create:** `src/server/idp.ts` (idpLoginUrl, verifyIdpToken, exchangeCode), `src/routes/api/auth/idp-login.ts`, `src/routes/api/auth/callback.ts`. Tests colocated (`*.test.ts`).
**Modify:** `src/server/auth-middleware.ts` (session value + identity + `isIdpEnabled`/`isAuthRequired` + state cookie helper), `src/routes/api/auth-check.ts` (+`idpEnabled`, `authRequired` via helper), `src/routes/api/auth.ts` (flag-gate 403), `src/components/auth/login-screen.tsx` (button), `.env.example`, `package.json` (+`jose`).

---

## Task 1: Session store identity + `authRequired` wiring + state cookie (`auth-middleware.ts`)

**Files:** Modify `src/server/auth-middleware.ts`. Test: `src/server/auth-middleware.test.ts`.

**Interfaces:**
- Produces: `SessionEntry = { expiry: number; userId?: string; email?: string }`; `storeSessionToken(token: string, identity?: { userId?: string; email?: string }): void`; `getSession(token: string): SessionEntry | null`; `isIdpEnabled(): boolean`; `isAuthRequired(): boolean`; `createIdpStateCookie(state: string): string`; `clearIdpStateCookie(): string`. `isValidSessionToken`/`isAuthenticated` keep their signatures.

- [ ] **Step 1: Write the failing tests** in `src/server/auth-middleware.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test gets an isolated HERMES_HOME so the file store doesn't leak.
let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "hermes-auth-")); process.env.HERMES_HOME = home; });
afterEach(() => { delete process.env.HERMES_HOME; delete process.env.AUTH_IDP_ENABLED; delete process.env.HERMES_PASSWORD; rmSync(home, { recursive: true, force: true }); });

it("stores + reads identity on a session token", async () => {
  const m = await import("./auth-middleware?seed=" + Math.random()); // fresh module (file store hydrates at load)
  const token = m.generateSessionToken();
  m.storeSessionToken(token, { userId: "u1", email: "a@b.c" });
  expect(m.isValidSessionToken(token)).toBe(true);
  expect(m.getSession(token)?.userId).toBe("u1");
});

it("isAuthRequired true when AUTH_IDP_ENABLED even without a password", async () => {
  process.env.AUTH_IDP_ENABLED = "true";
  const m = await import("./auth-middleware?idp=" + Math.random());
  expect(m.isAuthRequired()).toBe(true);
  expect(m.isAuthenticated(new Request("http://x/"))).toBe(false); // no cookie → not authed
});

it("loads an old-format session file (number values) without crashing", async () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "workspace-sessions.json"),
    JSON.stringify({ tokens: { legacy: Date.now() + 1_000_000 } }));
  const m = await import("./auth-middleware?legacy=" + Math.random());
  expect(m.isValidSessionToken("legacy")).toBe(true); // coerced to { expiry }
});
```

(The `?query` import trick forces vitest to re-evaluate the module so the file store re-hydrates per test. If the project's vitest config doesn't support query-suffixed imports, use `vi.resetModules()` + `await import("./auth-middleware")` in each test instead — pick whichever the repo's other tests use.)

- [ ] **Step 2: Run → fail.** `pnpm vitest run src/server/auth-middleware.test.ts`.

- [ ] **Step 3: Implement.** In `auth-middleware.ts`:

```ts
// value type now carries optional identity
interface SessionEntry { expiry: number; userId?: string; email?: string }
interface SessionStore { tokens: Record<string, SessionEntry | number> } // number = legacy on-disk

function coerce(v: SessionEntry | number): SessionEntry {
  return typeof v === "number" ? { expiry: v } : v;
}

// loadStore: coerce each value, keep if not expired
function loadStore(): { tokens: Record<string, SessionEntry> } {
  try {
    if (existsSync(STORE_FILE)) {
      const parsed = JSON.parse(readFileSync(STORE_FILE, "utf8")) as SessionStore;
      const now = Date.now();
      const valid: Record<string, SessionEntry> = {};
      for (const [token, v] of Object.entries(parsed.tokens)) {
        const e = coerce(v);
        if (e.expiry > now) valid[token] = e;
      }
      return { tokens: valid };
    }
  } catch { /* corrupt — fresh */ }
  return { tokens: {} };
}

const _tokens: Map<string, SessionEntry> = new Map();
// hydrate: for (const [t, e] of Object.entries(loadStore().tokens)) _tokens.set(t, e);
// _prune / _persist iterate SessionEntry (use .expiry); _persist writes Object.fromEntries(_tokens)

export function storeSessionToken(token: string, identity?: { userId?: string; email?: string }): void {
  _tokens.set(token, { expiry: Date.now() + TOKEN_TTL_MS, userId: identity?.userId, email: identity?.email });
  _persist();
}
export function getSession(token: string): SessionEntry | null { return _tokens.get(token) ?? null; }
export function isValidSessionToken(token: string): boolean {
  const e = _tokens.get(token);
  if (!e) return false;
  if (e.expiry <= Date.now()) { _tokens.delete(token); _persist(); return false; }
  return true;
}

export function isIdpEnabled(): boolean {
  const v = (process.env.AUTH_IDP_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
export function isAuthRequired(): boolean { return isPasswordProtectionEnabled() || isIdpEnabled(); }

export function isAuthenticated(request: Request): boolean {
  if (!isAuthRequired()) return true;                 // ← was: !isPasswordProtectionEnabled()
  const token = getSessionTokenFromCookie(request.headers.get("cookie"));
  if (!token) return false;
  return isValidSessionToken(token);
}

// state cookie for the IdP round-trip (Lax so it survives the redirect back)
export function createIdpStateCookie(state: string): string {
  const attrs = ["HttpOnly"];
  if (shouldSetSecureCookie()) attrs.push("Secure");
  attrs.push("SameSite=Lax", "Path=/api/auth/callback", "Max-Age=300");
  return `hermes_idp_state=${state}; ${attrs.join("; ")}`;
}
export function clearIdpStateCookie(): string {
  return `hermes_idp_state=; HttpOnly; SameSite=Lax; Path=/api/auth/callback; Max-Age=0`;
}
```

Update `_prune` and `_persist` to use `.expiry` and to (de)serialize `SessionEntry`. Keep `createSessionCookie` (the durable `claude-auth`) unchanged (`SameSite=Strict`). Keep `revokeSessionToken`/`generateSessionToken`/`verifyPassword`/`getSessionTokenFromCookie` as-is. Leave `requireLocalOrAuth` using `isPasswordProtectionEnabled` OR switch it to `isAuthRequired` — switch it, so IdP-mode is consistent.

- [ ] **Step 4: Run → pass.** `pnpm vitest run src/server/auth-middleware.test.ts` → 3 pass.
- [ ] **Step 5: Commit.** `git commit -am "feat(auth): session identity + authRequired(idp) + idp state cookie"`

---

## Task 2: `idp.ts` — login URL, token verify, code exchange (+ `jose` dep)

**Files:** Create `src/server/idp.ts`. Modify `package.json` (+`jose`). Test: `src/server/idp.test.ts`.

**Interfaces:**
- Produces: `IDP_AUD` (default `"hermes"`), `idpLoginUrl(state: string, origin: string): string`, `verifyIdpToken(token: string): Promise<{ userId: string; email?: string; role?: string }>`, `exchangeCode(code: string): Promise<string>`.

- [ ] **Step 1: Add `jose`.** `pnpm add jose` (a runtime dep). Confirm it lands in `package.json` dependencies.

- [ ] **Step 2: Failing tests** `src/server/idp.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT } from "jose";
import { idpLoginUrl, verifyIdpToken } from "./idp";

const SECRET = "test-idp-secret";
beforeAll(() => { process.env.JWT_SECRET = SECRET; process.env.IDP_BASE_URL = "http://127.0.0.1:3006"; });
const key = () => new TextEncoder().encode(SECRET);
async function idpJwt(claims: Record<string, unknown>, o: { iss?: string; aud?: string; exp?: number } = {}) {
  const b = new SignJWT(claims).setProtectedHeader({ alg: "HS256" })
    .setIssuer(o.iss ?? "ellie-idp").setAudience(o.aud ?? "hermes").setIssuedAt();
  return (o.exp !== undefined ? b.setExpirationTime(o.exp) : b.setExpirationTime("15m")).sign(key());
}

it("idpLoginUrl has redirect_uri/state/aud=hermes", () => {
  const u = idpLoginUrl("st8", "http://localhost:3302");
  expect(u).toContain("/login?");
  expect(u).toContain("aud=hermes");
  expect(u).toContain("state=st8");
  expect(u).toContain(encodeURIComponent("http://localhost:3302/api/auth/callback"));
});
it("verifyIdpToken accepts a valid iss=ellie-idp aud=hermes token", async () => {
  const t = await idpJwt({ userId: "u1", email: "a@b.c" });
  const c = await verifyIdpToken(t);
  expect(c.userId).toBe("u1"); expect(c.email).toBe("a@b.c");
});
it("rejects wrong aud / wrong iss / expired", async () => {
  await expect(verifyIdpToken(await idpJwt({ userId: "x" }, { aud: "pg" }))).rejects.toThrow();
  await expect(verifyIdpToken(await idpJwt({ userId: "x" }, { iss: "evil" }))).rejects.toThrow();
  const past = Math.floor(Date.now() / 1000) - 60;
  await expect(verifyIdpToken(await idpJwt({ userId: "x" }, { exp: past }))).rejects.toThrow();
});
```

- [ ] **Step 3: Run → fail.**
- [ ] **Step 4: Implement** `src/server/idp.ts`:

```ts
import { jwtVerify } from "jose";

export const IDP_AUD = process.env.IDP_AUD || "hermes";
function idpBaseUrl(): string { return process.env.IDP_BASE_URL || "http://127.0.0.1:3006"; }
function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not set");
  return new TextEncoder().encode(s);
}

export function idpLoginUrl(state: string, origin: string): string {
  const q = new URLSearchParams({ redirect_uri: `${origin}/api/auth/callback`, state, aud: IDP_AUD });
  return `${idpBaseUrl()}/login?${q.toString()}`;
}

export interface IdpClaims { userId: string; email?: string; role?: string }
export async function verifyIdpToken(token: string): Promise<IdpClaims> {
  const { payload } = await jwtVerify(token, secret(), {
    issuer: "ellie-idp", audience: IDP_AUD, clockTolerance: 30,
  });
  return { userId: payload.userId as string, email: payload.email as string | undefined, role: payload.role as string | undefined };
}

export async function exchangeCode(code: string): Promise<string> {
  const url = `${idpBaseUrl()}/auth/exchange`;
  const attempt = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      return await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), signal: ctrl.signal });
    } finally { clearTimeout(timer); }
  };
  let res: Response;
  try { res = await attempt(); }
  catch { res = await attempt(); }            // retry once on network throw
  if (!res.ok && res.status >= 500) res = await attempt(); // retry once on 5xx
  if (!res.ok) throw new Error(`idp exchange failed: ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("idp exchange: no access_token");
  return body.access_token;
}
```

- [ ] **Step 5: Run → pass.** `pnpm vitest run src/server/idp.test.ts` → 3 pass.
- [ ] **Step 6: Commit.** `git commit -am "feat(auth): idp helpers (login url, verifyIdpToken, exchangeCode) + jose dep"`

---

## Task 3: `GET /api/auth/idp-login` route

**Files:** Create `src/routes/api/auth/idp-login.ts`. Test: `src/routes/api/auth/idp-login.test.ts`.

**Interfaces:** Consumes `idpLoginUrl` (Task 2), `createIdpStateCookie` (Task 1), `rateLimit`/`getClientIp` (`src/server/rate-limit`). Produces the route + (for testability) an exported `handleIdpLogin(request: Request): Response`.

- [ ] **Step 1: Failing test** `idp-login.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { handleIdpLogin } from "./idp-login";

it("302s to the IdP and sets the state cookie matching the URL state", () => {
  process.env.IDP_BASE_URL = "http://127.0.0.1:3006";
  const res = handleIdpLogin(new Request("http://localhost:3302/api/auth/idp-login"));
  expect(res.status).toBe(302);
  const loc = res.headers.get("Location") ?? "";
  expect(loc).toContain("/login?"); expect(loc).toContain("aud=hermes");
  const sc = res.headers.get("Set-Cookie") ?? "";
  expect(sc).toContain("hermes_idp_state="); expect(sc).toContain("Path=/api/auth/callback"); expect(sc).toContain("Max-Age=300");
  const state = /hermes_idp_state=([0-9a-f]+)/.exec(sc)?.[1];
  expect(loc).toContain(`state=${state}`);
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `idp-login.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "node:crypto";
import { idpLoginUrl } from "../../../server/idp";
import { createIdpStateCookie } from "../../../server/auth-middleware";
import { getClientIp, rateLimit, rateLimitResponse } from "../../../server/rate-limit";

export function handleIdpLogin(request: Request): Response {
  const ip = getClientIp(request);
  if (!rateLimit(`idp-login:${ip}`, 10, 60_000)) return rateLimitResponse();
  const state = randomBytes(32).toString("hex");
  const origin = new URL(request.url).origin;
  return new Response(null, {
    status: 302,
    headers: { Location: idpLoginUrl(state, origin), "Set-Cookie": createIdpStateCookie(state) },
  });
}

export const Route = createFileRoute("/api/auth/idp-login")({
  server: { handlers: { GET: async ({ request }) => handleIdpLogin(request) } },
});
```

- [ ] **Step 4: Run → pass.** `pnpm vitest run src/routes/api/auth/idp-login.test.ts`.
- [ ] **Step 5: Commit.** `git commit -am "feat(auth): GET /api/auth/idp-login (state cookie + redirect + rate limit)"`

---

## Task 4: `GET /api/auth/callback` route (exchange → verify → mint session)

**Files:** Create `src/routes/api/auth/callback.ts`. Test: `src/routes/api/auth/callback.test.ts`.

**Interfaces:** Consumes `exchangeCode`/`verifyIdpToken` (Task 2), `generateSessionToken`/`storeSessionToken`/`createSessionCookie`/`getSession`/`clearIdpStateCookie` (Task 1). Produces the route + exported `handleCallback(request: Request): Promise<Response>` and a mutable `_deps = { exchangeCode, verifyIdpToken }` test seam.

- [ ] **Step 1: Failing test** `callback.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import * as cb from "./callback";
import { getSession, getSessionTokenFromCookie } from "../../../server/auth-middleware";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "hermes-cb-")); process.env.HERMES_HOME = home; });
afterEach(() => { delete process.env.HERMES_HOME; rmSync(home, { recursive: true, force: true }); });

function req(code: string, state: string, cookieState = state) {
  return new Request(`http://localhost:3302/api/auth/callback?code=${code}&state=${state}`, { headers: { cookie: `hermes_idp_state=${cookieState}` } });
}

it("happy path mints a session recording userId and 302s to /", async () => {
  cb._deps.exchangeCode = async () => "stub";
  cb._deps.verifyIdpToken = async () => ({ userId: "u9", email: "u9@t.c" });
  const res = await cb.handleCallback(req("c", "s"));
  expect(res.status).toBe(302); expect(res.headers.get("Location")).toBe("/");
  const cookies = res.headers.getSetCookie();
  const auth = cookies.find((c) => c.startsWith("claude-auth="))!;
  expect(auth).toBeTruthy();
  const token = getSessionTokenFromCookie(auth.split(";")[0]);
  expect(getSession(token!)?.userId).toBe("u9");
  expect(cookies.some((c) => c.startsWith("hermes_idp_state=") && c.includes("Max-Age=0"))).toBe(true);
});
it("state mismatch → no session, redirect with error", async () => {
  const res = await cb.handleCallback(req("c", "s", "DIFFERENT"));
  expect(res.status).toBe(302); expect(res.headers.get("Location")).toContain("login_error");
  expect((res.headers.getSetCookie() ?? []).some((c) => c.startsWith("claude-auth="))).toBe(false);
});
it("exchange/verify throw → no session, redirect with error", async () => {
  cb._deps.exchangeCode = async () => { throw new Error("boom"); };
  const res = await cb.handleCallback(req("c", "s"));
  expect(res.status).toBe(302); expect(res.headers.get("Location")).toContain("login_error");
  expect((res.headers.getSetCookie() ?? []).some((c) => c.startsWith("claude-auth="))).toBe(false);
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `callback.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { exchangeCode as _exchange, verifyIdpToken as _verify } from "../../../server/idp";
import { generateSessionToken, storeSessionToken, createSessionCookie, clearIdpStateCookie } from "../../../server/auth-middleware";

export const _deps = { exchangeCode: _exchange, verifyIdpToken: _verify };

function readState(request: Request): string | null {
  const h = request.headers.get("cookie"); if (!h) return null;
  for (const p of h.split(";")) { const i = p.indexOf("="); if (i === -1) continue;
    if (p.slice(0, i).trim() === "hermes_idp_state") return p.slice(i + 1).trim(); }
  return null;
}
function redirect(location: string, extra?: string): Response {
  const h = new Headers({ Location: location });
  h.append("Set-Cookie", clearIdpStateCookie());
  if (extra) h.append("Set-Cookie", extra);
  return new Response(null, { status: 302, headers: h });
}

export async function handleCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = readState(request);
  if (!code || !state || !cookieState || cookieState !== state) {
    return redirect("/?login_error=idp_state");
  }
  let claims;
  try {
    const token = await _deps.exchangeCode(code);
    claims = await _deps.verifyIdpToken(token);
  } catch { return redirect("/?login_error=idp"); }

  const session = generateSessionToken();
  storeSessionToken(session, { userId: claims.userId, email: claims.email });
  return redirect("/", createSessionCookie(session));
}

export const Route = createFileRoute("/api/auth/callback")({
  server: { handlers: { GET: async ({ request }) => handleCallback(request) } },
});
```

- [ ] **Step 4: Run → pass.** `pnpm vitest run src/routes/api/auth/callback.test.ts` → 3 pass.
- [ ] **Step 5: Commit.** `git commit -am "feat(auth): GET /api/auth/callback — exchange→verify→mint session (records identity)"`

---

## Task 5: auth-check `idpEnabled`/`authRequired` + flag-gate `POST /api/auth`

**Files:** Modify `src/routes/api/auth-check.ts`, `src/routes/api/auth.ts`. Test: `src/routes/api/auth-flag.test.ts`.

- [ ] **Step 1: Failing test** `auth-flag.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { handleAuthPost } from "./auth";              // exported in Step 3
import { computeAuthCheck } from "./auth-check";        // exported in Step 3

afterEach(() => { delete process.env.AUTH_IDP_ENABLED; delete process.env.HERMES_PASSWORD; });

it("auth-check reports idpEnabled + authRequired when AUTH_IDP_ENABLED", () => {
  process.env.AUTH_IDP_ENABLED = "true";
  const r = computeAuthCheck(new Request("http://x/"));
  expect(r.idpEnabled).toBe(true); expect(r.authRequired).toBe(true);
});
it("POST /api/auth returns 403 when AUTH_IDP_ENABLED", async () => {
  process.env.AUTH_IDP_ENABLED = "true"; process.env.HERMES_PASSWORD = "pw";
  const res = await handleAuthPost(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "pw" }),
  }));
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.**
  - In `auth-check.ts`, extract the post-gateway logic into an exported pure helper and return `idpEnabled` + `authRequired` via the new helper:
    ```ts
    import { isAuthenticated, isAuthRequired, isIdpEnabled } from "../../server/auth-middleware";
    export function computeAuthCheck(request: Request) {
      return { authenticated: isAuthenticated(request), authRequired: isAuthRequired(), idpEnabled: isIdpEnabled() };
    }
    ```
    and in the GET handler, after the gateway-reachability block, `return json(computeAuthCheck(request));`.
  - In `auth.ts`, extract the handler body into an exported `handleAuthPost(request)` and add, as its FIRST action (after the json content-type check), the flag gate:
    ```ts
    import { isIdpEnabled } from "../../server/auth-middleware";
    if (isIdpEnabled()) return json({ ok: false, error: "Password login disabled; use the IdP" }, { status: 403 });
    ```
    Keep `POST` wired to `handleAuthPost`.

- [ ] **Step 4: Run → pass.** `pnpm vitest run src/routes/api/auth-flag.test.ts`.
- [ ] **Step 5: Commit.** `git commit -am "feat(auth): auth-check idpEnabled/authRequired + flag-gate password login"`

---

## Task 6: Login UI — "Sign in with Ellie" button

**Files:** Modify `src/components/auth/login-screen.tsx`. (And the root layout / auth-check client type if it carries a typed shape — surface `idpEnabled`.)

- [ ] **Step 1: Implement.** The root layout fetches `/api/auth-check` (`fetchClaudeAuthStatus` in `__root.tsx`) and passes status to `LoginScreen`. Thread `idpEnabled` through that status (extend its type + the fetch result). In `LoginScreen`: when `idpEnabled` is true, render a single button **"Sign in with Ellie"** with `onClick={() => { window.location.href = "/api/auth/idp-login"; }}` and hide the password form/inputs. When false, render the existing password form unchanged. Match the component's existing styling/classNames.
- [ ] **Step 2: Typecheck/build.** `pnpm vitest run` (the existing `*.test.ts` suite) stays green; run the repo's typecheck if present (`pnpm tsc --noEmit` or the `check` script). If a component test harness exists, add a light test that the button renders when `idpEnabled` is true; otherwise note manual verification.
- [ ] **Step 3: Commit.** `git commit -am "feat(workspace): Sign in with Ellie button when AUTH_IDP_ENABLED"`

---

## Task 7: `.env.example` + full-suite verification

**Files:** Modify `.env.example`.

- [ ] **Step 1: Document env.** Add to `.env.example` (with comments): `AUTH_IDP_ENABLED=false`, `IDP_BASE_URL=http://127.0.0.1:3006`, `IDP_AUD=hermes`, and a note that `JWT_SECRET` must equal the IdP's `LIFE_JWT_SECRET`. Also note that the hermes origin must be in the IdP's `IDP_REDIRECT_ALLOWLIST` (`:3302` already is).
- [ ] **Step 2: Full suite green.** `pnpm vitest run` → the new tests pass and nothing regressed (record any pre-existing failures unrelated to this work).
- [ ] **Step 3: Manual smoke (documented).** With the IdP running + `AUTH_IDP_ENABLED=true JWT_SECRET=<shared> PORT=3302`, start hermes-workspace, hit `/api/auth/idp-login` → lands at the IdP `/login`; `/api/auth-check` returns `idpEnabled:true, authRequired:true`.
- [ ] **Step 4: Commit.** `git commit -am "docs(env): IdP login delegation vars + Phase 1b verification"`

---

## Phase-1b Done = Definition

- `AUTH_IDP_ENABLED=true` → hermes-workspace shows "Sign in with Ellie" → IdP login → callback exchanges+verifies → mints the existing opaque session recording `userId` → reaches the workspace; per-request auth unchanged.
- `authRequired` true under IdP even without a legacy password; `AUTH_IDP_ENABLED=false` restores password login.
- No IdP-side change; `:3302` already allowlisted. `pnpm vitest run` green.

## Out of scope (deferred)
Per-request JWT validation; multi-user features on the recorded `userId`; logout endpoint; removing password login; `/api/auth/me`.
