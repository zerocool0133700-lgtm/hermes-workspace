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
