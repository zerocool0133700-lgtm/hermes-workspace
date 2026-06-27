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
