import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { ensureGatewayProbed } from '../../server/claude-api'
import { resolveSessionKey } from '../../server/session-utils'
import { Route } from './send-stream'

// The POST handler reaches several dependencies before it ever builds the SSE
// stream: auth, the JSON Content-Type/CSRF gate, a gateway probe, body parsing,
// and session-key resolution. Mocking just those lets us exercise every
// input-validation / error branch deterministically without any real network,
// gateway, or streaming work. The success path (which spawns a ReadableStream
// and talks to the live gateway/openai-compat surface) is intentionally NOT
// exercised here — see the summary for why.
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))
vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: vi.fn(),
}))
vi.mock('../../server/claude-api', () => ({
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'sessions api unavailable',
  createSession: vi.fn(),
  ensureGatewayProbed: vi.fn(),
  getGatewayCapabilities: vi.fn(() => ({ sessions: false })),
  getMessages: vi.fn(() => Promise.resolve([])),
  listSessions: vi.fn(() => Promise.resolve([])),
  streamChat: vi.fn(),
}))
vi.mock('../../server/session-utils', () => ({
  resolveSessionKey: vi.fn(),
}))
vi.mock('../../server/gateway-capabilities', () => ({
  getChatMode: vi.fn(() => 'enhanced'),
}))
vi.mock('../../server/local-provider-discovery', () => ({
  getDiscoveredModels: vi.fn(() => []),
  getLocalProviderDef: vi.fn(() => undefined),
}))

type RouteWithHandlers = typeof Route & {
  options: {
    server: {
      handlers: {
        POST: (ctx: { request: Request }) => Promise<Response>
      }
    }
  }
}

const handler = (Route as RouteWithHandlers).options.server.handlers.POST

function jsonPost(body: unknown): Request {
  return new Request('http://localhost/api/send-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

type ErrorBody = { ok: boolean; error: string }

beforeEach(() => {
  vi.mocked(isAuthenticated).mockReturnValue(true)
  vi.mocked(requireJsonContentType).mockReturnValue(null)
  // The early-return branches never read the probe result; a minimal
  // partial capabilities object keeps the resolved value well-typed.
  vi.mocked(ensureGatewayProbed).mockResolvedValue({
    sessions: false,
  } as Awaited<ReturnType<typeof ensureGatewayProbed>>)
  vi.mocked(resolveSessionKey).mockResolvedValue({
    sessionKey: 'session-1',
    resolvedVia: 'raw',
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/send-stream auth and CSRF gates', () => {
  it('returns 401 when the request is unauthenticated', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)

    const res = await handler({ request: jsonPost({ message: 'hi' }) })

    expect(res.status).toBe(401)
    const body = (await res.json()) as ErrorBody
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Unauthorized')
    // Short-circuits before the gateway probe runs.
    expect(ensureGatewayProbed).not.toHaveBeenCalled()
  })

  it('returns the CSRF/Content-Type rejection when requireJsonContentType blocks the request', async () => {
    const csrfResponse = new Response(
      JSON.stringify({ ok: false, error: 'bad content type' }),
      { status: 415, headers: { 'Content-Type': 'application/json' } },
    )
    vi.mocked(requireJsonContentType).mockReturnValue(csrfResponse)

    const req = new Request('http://localhost/api/send-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'message=hi',
    })
    const res = await handler({ request: req })

    expect(res.status).toBe(415)
    expect(res).toBe(csrfResponse)
    expect(ensureGatewayProbed).not.toHaveBeenCalled()
  })
})

describe('POST /api/send-stream body validation', () => {
  it('returns 400 when the body is not valid JSON', async () => {
    const res = await handler({ request: jsonPost('not-json-at-all') })

    expect(res.status).toBe(400)
    const body = (await res.json()) as ErrorBody
    expect(body.ok).toBe(false)
    expect(body.error).toBe('message required')
    // The probe still runs before body parsing.
    expect(ensureGatewayProbed).toHaveBeenCalledTimes(1)
    // Never reaches session resolution.
    expect(resolveSessionKey).not.toHaveBeenCalled()
  })

  it('returns 400 when message is empty and there are no attachments', async () => {
    const res = await handler({ request: jsonPost({ message: '   ' }) })

    expect(res.status).toBe(400)
    const body = (await res.json()) as ErrorBody
    expect(body.error).toBe('message required')
    expect(resolveSessionKey).not.toHaveBeenCalled()
  })

  it('treats a blank message with usable image attachments as valid (passes the 400 gate to session resolution)', async () => {
    // A 1x1 transparent PNG payload as a base64 attachment with no text.
    const res = await handler({
      request: jsonPost({
        message: '',
        attachments: [
          {
            name: 'pixel.png',
            contentType: 'image/png',
            content:
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
          },
        ],
      }),
    })

    // It must NOT be the 400 "message required" branch — the attachment
    // satisfies the content requirement and the handler proceeds.
    expect(res.status).not.toBe(400)
    expect(resolveSessionKey).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/send-stream session resolution failures', () => {
  it('returns 404 when resolveSessionKey reports the session was not found', async () => {
    vi.mocked(resolveSessionKey).mockRejectedValue(
      new Error('session not found'),
    )

    const res = await handler({ request: jsonPost({ message: 'hi' }) })

    expect(res.status).toBe(404)
    const body = (await res.json()) as ErrorBody
    expect(body.ok).toBe(false)
    expect(body.error).toBe('session not found')
  })

  it('returns 500 and a sanitized message for other session resolution errors', async () => {
    // "server" is rewritten to "Claude" by normalizeClaudeErrorMessage.
    vi.mocked(resolveSessionKey).mockRejectedValue(
      new Error('server exploded while resolving'),
    )

    const res = await handler({ request: jsonPost({ message: 'hi' }) })

    expect(res.status).toBe(500)
    const body = (await res.json()) as ErrorBody
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Claude exploded while resolving')
    expect(body.error).not.toMatch(/\bserver\b/i)
  })
})
