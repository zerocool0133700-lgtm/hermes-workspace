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
