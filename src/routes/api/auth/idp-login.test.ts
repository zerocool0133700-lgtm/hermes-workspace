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
