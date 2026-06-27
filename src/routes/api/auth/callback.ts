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
