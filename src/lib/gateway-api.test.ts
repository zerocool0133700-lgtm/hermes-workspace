import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BASE_URL,
  fetchGatewayApprovals,
  fetchModels,
  fetchSessionHistory,
  fetchSessionStatus,
  fetchSessions,
  killAgentSession,
  resolveGatewayApproval,
  sendToSession,
  setDefaultModel,
  steerAgent,
  switchModel,
  toggleAgentPause,
} from './gateway-api'

// In the vitest node environment `window` is undefined, so the module's
// BASE_URL falls back to the local gateway origin. Anchor the URL assertions
// against the same constant the module computed.
const ORIGIN = BASE_URL

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

function getFetchMock(): FetchMock {
  // `globalThis.fetch` is the stubbed mock; narrow it for type-safe access.
  return globalThis.fetch as unknown as FetchMock
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

/** Read the JSON body that was passed to a mocked fetch call. */
function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  if (!init || typeof init.body !== 'string') return {}
  const parsed: unknown = JSON.parse(init.body)
  if (parsed !== null && typeof parsed === 'object') {
    return parsed as Record<string, unknown>
  }
  return {}
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('fetchSessions', () => {
  it('returns the parsed payload for a well-formed JSON array', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({ sessions: [{ key: 'a' }, { key: 'b' }] }),
    )

    const result = await fetchSessions()

    expect(result.sessions).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/api/sessions`, {
      headers: { accept: 'application/json' },
    })
  })

  it('surfaces the server error message on a non-OK status', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse(
        { error: 'gateway exploded' },
        { status: 500, statusText: 'Internal Server Error' },
      ),
    )

    await expect(fetchSessions()).rejects.toThrow('gateway exploded')
  })

  it('rejects responses that are not JSON content-type', async () => {
    getFetchMock().mockResolvedValue(
      new Response('<html>login</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    await expect(fetchSessions()).rejects.toThrow(/non-JSON content/i)
  })

  it('rejects when the sessions field is not an array', async () => {
    getFetchMock().mockResolvedValue(jsonResponse({ sessions: 'nope' }))

    await expect(fetchSessions()).rejects.toThrow(/unexpected response shape/i)
  })
})

describe('fetchSessionHistory', () => {
  it('returns the parsed history on success and builds the query string', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, messages: [{ role: 'user', content: 'hi' }] }),
    )

    const result = await fetchSessionHistory('sess-1', {
      limit: 5,
      includeTools: true,
    })

    expect(result.ok).toBe(true)
    expect(result.messages).toHaveLength(1)
    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toContain(`${ORIGIN}/api/session-history?`)
    expect(url).toContain('key=sess-1')
    expect(url).toContain('limit=5')
    expect(url).toContain('includeTools=true')
  })

  it('returns an ok:false envelope with the server error on non-OK status', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ error: 'no such session' }, { status: 404 }),
    )

    const result = await fetchSessionHistory('missing')

    expect(result).toEqual({
      ok: false,
      messages: [],
      error: 'no such session',
    })
  })

  it('reports a timeout for an aborted request rather than a raw error', async () => {
    getFetchMock().mockRejectedValue(abortError())

    const result = await fetchSessionHistory('sess-1')

    expect(result).toEqual({
      ok: false,
      messages: [],
      error: 'Request timed out',
    })
  })

  it('stringifies a generic network error into the envelope', async () => {
    getFetchMock().mockRejectedValue(new Error('connection refused'))

    const result = await fetchSessionHistory('sess-1')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('connection refused')
  })
})

describe('sendToSession', () => {
  it('posts the session key and message and returns the payload', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    const result = await sendToSession('sess-1', 'hello there')

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${ORIGIN}/api/session-send`)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(bodyOf(init)).toEqual({
      sessionKey: 'sess-1',
      message: 'hello there',
    })
  })

  it('throws the server error when payload.ok is false even on a 200', async () => {
    getFetchMock().mockResolvedValue(jsonResponse({ ok: false, error: 'busy' }))

    await expect(sendToSession('sess-1', 'hi')).rejects.toThrow('busy')
  })

  it('falls back to statusText when an error body is missing', async () => {
    getFetchMock().mockResolvedValue(
      new Response('not json', { status: 502, statusText: 'Bad Gateway' }),
    )

    await expect(sendToSession('sess-1', 'hi')).rejects.toThrow('Bad Gateway')
  })

  it('throws a timeout error for an aborted request', async () => {
    getFetchMock().mockRejectedValue(abortError())

    await expect(sendToSession('sess-1', 'hi')).rejects.toThrow(
      'Request timed out',
    )
  })
})

describe('fetchSessionStatus', () => {
  it('returns the raw status object when there is no nested payload wrapper', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ status: 'running', progress: 0.5 }),
    )

    const result = await fetchSessionStatus('sess-1')

    expect(result.status).toBe('running')
    expect(result.progress).toBe(0.5)
  })

  it('unwraps a nested payload envelope', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ payload: { status: 'done', progress: 1 } }),
    )

    const result = await fetchSessionStatus('sess-1')

    expect(result.status).toBe('done')
    expect(result.progress).toBe(1)
  })

  it('encodes the session key into the query string', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ status: 'idle' }))

    await fetchSessionStatus('a b/c')

    expect(fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}/api/session-status?key=a%20b%2Fc`,
    )
  })

  it('throws the server error on non-OK status', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ message: 'status unavailable' }, { status: 503 }),
    )

    await expect(fetchSessionStatus('sess-1')).rejects.toThrow(
      'status unavailable',
    )
  })
})

describe('fetchModels', () => {
  it('normalizes models and providers to arrays and forces ok:true', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({
        models: ['gpt-5', 'claude'],
        configuredProviders: ['openai'],
      }),
    )

    const result = await fetchModels()

    expect(result).toEqual({
      ok: true,
      models: ['gpt-5', 'claude'],
      configuredProviders: ['openai'],
    })
  })

  it('coerces non-array fields to empty arrays', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ models: null, configuredProviders: 'openai' }),
    )

    const result = await fetchModels()

    expect(result.models).toEqual([])
    expect(result.configuredProviders).toEqual([])
  })

  it('throws when the payload reports ok:false', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ ok: false, error: 'no models configured' }),
    )

    await expect(fetchModels()).rejects.toThrow('no models configured')
  })

  it('throws "Gateway disconnected" when the request aborts', async () => {
    getFetchMock().mockRejectedValue(abortError())

    await expect(fetchModels()).rejects.toThrow('Gateway disconnected')
  })
})

describe('switchModel', () => {
  it('posts the model and session key and returns the resolved payload', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, resolved: { model: 'gpt-5' } }),
    )

    const result = await switchModel('gpt-5', 'sess-1')

    expect(result.resolved?.model).toBe('gpt-5')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${ORIGIN}/api/model-switch`)
    expect(init?.method).toBe('POST')
    expect(bodyOf(init)).toEqual({ model: 'gpt-5', sessionKey: 'sess-1' })
  })

  it('throws the server error message on a non-OK status', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ error: 'unknown model' }, { status: 400 }),
    )

    await expect(switchModel('bogus')).rejects.toThrow('unknown model')
  })

  it('throws a timeout error when aborted', async () => {
    getFetchMock().mockRejectedValue(abortError())

    await expect(switchModel('gpt-5')).rejects.toThrow('Request timed out')
  })
})

describe('setDefaultModel', () => {
  it('posts a config-patch with the serialized default model', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    const result = await setDefaultModel('gpt-5')

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${ORIGIN}/api/config-patch`)
    const body = bodyOf(init)
    expect(body.reason).toBe('Studio: set default model')
    expect(typeof body.raw).toBe('string')
    const raw: unknown = JSON.parse(String(body.raw))
    expect(raw).toEqual({ defaultModel: 'gpt-5' })
  })

  it('throws the server error when persistence fails', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ ok: false, error: 'disk full' }, { status: 500 }),
    )

    await expect(setDefaultModel('gpt-5')).rejects.toThrow('disk full')
  })
})

describe('steerAgent', () => {
  it('posts the directive and returns the payload', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    const result = await steerAgent('sess-1', 'focus on tests')

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${ORIGIN}/api/agent-steer`)
    expect(bodyOf(init)).toEqual({
      sessionKey: 'sess-1',
      message: 'focus on tests',
    })
  })

  it('throws the server error on failure', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ ok: false, error: 'agent not steerable' }),
    )

    await expect(steerAgent('sess-1', 'x')).rejects.toThrow(
      'agent not steerable',
    )
  })
})

describe('killAgentSession', () => {
  it('posts only the session key and returns the payload', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    const result = await killAgentSession('sess-1')

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${ORIGIN}/api/agent-kill`)
    expect(bodyOf(init)).toEqual({ sessionKey: 'sess-1' })
  })

  it('falls back to statusText when the error body is empty', async () => {
    getFetchMock().mockResolvedValue(
      new Response('', { status: 409, statusText: 'Conflict' }),
    )

    await expect(killAgentSession('sess-1')).rejects.toThrow('Conflict')
  })
})

describe('toggleAgentPause', () => {
  it('posts the pause flag and returns the paused state', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, paused: true }))

    const result = await toggleAgentPause('sess-1', true)

    expect(result.paused).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${ORIGIN}/api/agent-pause`)
    expect(bodyOf(init)).toEqual({ sessionKey: 'sess-1', pause: true })
  })

  it('throws a timeout error when aborted', async () => {
    getFetchMock().mockRejectedValue(abortError())

    await expect(toggleAgentPause('sess-1', false)).rejects.toThrow(
      'Request timed out',
    )
  })
})

describe('fetchGatewayApprovals', () => {
  it('returns the parsed approvals on success', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, approvals: [{ id: 'ap-1' }] }),
    )

    const result = await fetchGatewayApprovals()

    expect(result.ok).toBe(true)
    expect(result.approvals).toEqual([{ id: 'ap-1' }])
    expect(fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}/api/gateway/approvals`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('returns an empty ok:false envelope on a non-OK status', async () => {
    getFetchMock().mockResolvedValue(new Response('', { status: 500 }))

    const result = await fetchGatewayApprovals()

    expect(result).toEqual({ ok: false, approvals: [] })
  })

  it('swallows network errors into an empty ok:false envelope', async () => {
    getFetchMock().mockRejectedValue(new Error('offline'))

    const result = await fetchGatewayApprovals()

    expect(result).toEqual({ ok: false, approvals: [] })
  })
})

describe('resolveGatewayApproval', () => {
  it('posts to the approve endpoint and returns ok:true on success', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(new Response('', { status: 200 }))

    const result = await resolveGatewayApproval('ap-1', 'approve')

    expect(result).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${ORIGIN}/api/gateway/approvals/ap-1/approve`)
    expect(init?.method).toBe('POST')
  })

  it('reflects a non-OK status as ok:false', async () => {
    getFetchMock().mockResolvedValue(new Response('', { status: 404 }))

    const result = await resolveGatewayApproval('ap-1', 'deny')

    expect(result).toEqual({ ok: false })
    const url = String(getFetchMock().mock.calls[0]?.[0])
    expect(url).toBe(`${ORIGIN}/api/gateway/approvals/ap-1/deny`)
  })

  it('swallows network errors into ok:false', async () => {
    getFetchMock().mockRejectedValue(new Error('offline'))

    const result = await resolveGatewayApproval('ap-1', 'approve')

    expect(result).toEqual({ ok: false })
  })
})
