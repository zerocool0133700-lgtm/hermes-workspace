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
