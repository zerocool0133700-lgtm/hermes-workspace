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
