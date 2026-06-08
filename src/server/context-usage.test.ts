import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  dashboardFetch,
  ensureGatewayProbed,
  getCapabilities,
} from './gateway-capabilities'
import { listSessions } from './claude-api'
import { getLocalMessages, getLocalSession } from './local-session-store'
import { getActiveRunForSession } from './run-store'
import {
  estimateContextTokensFromCacheRead,
  estimateContextTokensFromMessages,
  readContextUsage,
} from './context-usage'
import type { ClaudeSession } from './claude-api'
import type { LocalMessage, LocalSession } from './local-session-store'
import type { PersistedRunState } from './run-store'
import type { GatewayCapabilities } from './gateway-capabilities'

// ─── Typed mock builders (real types — no `any`) ────────────────────────

function mockLocalSession(overrides: Partial<LocalSession>): LocalSession {
  return {
    id: 'local-session',
    title: null,
    model: null,
    createdAt: 0,
    updatedAt: 0,
    messageCount: 0,
    ...overrides,
  }
}

/**
 * Build a LocalMessage. The persisted `content` field is typed as a string,
 * but production messages can carry structured content arrays that the token
 * estimator walks, so the input is widened to `unknown` here rather than
 * casting. The estimator only reads `content`, so a structural object that
 * satisfies LocalMessage's required keys is sufficient.
 */
function mockLocalMessage(
  overrides: Partial<Omit<LocalMessage, 'content'>> & { content?: unknown },
): LocalMessage {
  return {
    id: 'msg',
    content: '',
    timestamp: 0,
    ...overrides,
  } as LocalMessage
}

function mockCapabilities(
  dashboard: Partial<GatewayCapabilities['dashboard']>,
  extra: Partial<GatewayCapabilities> = {},
): GatewayCapabilities {
  return {
    health: false,
    chatCompletions: false,
    models: false,
    streaming: false,
    sessions: false,
    enhancedChat: false,
    skills: false,
    memory: false,
    config: false,
    jobs: false,
    mcp: false,
    mcpFallback: false,
    conductor: false,
    kanban: false,
    probed: false,
    dashboard: { available: false, url: '', ...dashboard },
    ...extra,
  }
}

function mockActiveRun(
  overrides: Partial<PersistedRunState>,
): PersistedRunState {
  return {
    runId: 'run-1',
    sessionKey: 'session',
    friendlyId: 'friendly',
    status: 'active',
    createdAt: 0,
    updatedAt: 0,
    lastEventAt: 0,
    assistantText: '',
    thinkingText: '',
    toolCalls: [],
    lifecycleEvents: [],
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

vi.mock('./gateway-capabilities', () => ({
  BEARER_TOKEN: '',
  CLAUDE_API: 'http://127.0.0.1:8642',
  dashboardFetch: vi.fn(),
  ensureGatewayProbed: vi.fn(() =>
    Promise.resolve({ dashboard: { available: false } }),
  ),
  getCapabilities: vi.fn(() => ({ dashboard: { available: false } })),
}))

vi.mock('./claude-api', () => ({
  listSessions: vi.fn(() => Promise.resolve([])),
}))

vi.mock('./local-session-store', () => ({
  getLocalMessages: vi.fn(() => []),
  getLocalSession: vi.fn(() => null),
}))

vi.mock('./run-store', () => ({
  getActiveRunForSession: vi.fn(() => Promise.resolve(null)),
}))

/** Default capability state: dashboard unavailable, vanilla gateway path. */
function withVanillaGateway(): void {
  vi.mocked(getCapabilities).mockReturnValue(mockCapabilities({}))
  vi.mocked(ensureGatewayProbed).mockResolvedValue(mockCapabilities({}))
}

/** Default capability state: dashboard available. */
function withDashboard(extra: Partial<GatewayCapabilities> = {}): void {
  vi.mocked(getCapabilities).mockReturnValue(
    mockCapabilities({ available: true, url: 'http://dash' }, extra),
  )
  vi.mocked(ensureGatewayProbed).mockResolvedValue(
    mockCapabilities({ available: true, url: 'http://dash' }, extra),
  )
}

// `vi.clearAllMocks()` resets call history but NOT implementations set via
// `mockReturnValue`/`mockResolvedValue`, so those would leak between tests.
// Re-establish the inert defaults before every test instead.
beforeEach(() => {
  vi.mocked(getLocalMessages).mockReturnValue([])
  vi.mocked(getLocalSession).mockReturnValue(null)
  vi.mocked(listSessions).mockResolvedValue([])
  vi.mocked(getActiveRunForSession).mockResolvedValue(null)
  vi.mocked(dashboardFetch).mockResolvedValue(
    new Response('not found', { status: 404 }),
  )
  withVanillaGateway()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ───────────────────────────────────────────────────────────────────────
// estimateContextTokensFromMessages
// ───────────────────────────────────────────────────────────────────────

describe('estimateContextTokensFromMessages', () => {
  it('returns 0 for an empty list', () => {
    expect(estimateContextTokensFromMessages([])).toBe(0)
  })

  it('estimates ceil(chars / 3.5) for a plain string content', () => {
    // 70 chars / 3.5 = 20 tokens exactly
    expect(
      estimateContextTokensFromMessages([{ content: 'x'.repeat(70) }]),
    ).toBe(20)
  })

  it('rounds partial tokens up (Math.ceil)', () => {
    // 8 chars / 3.5 = 2.28 → 3
    expect(
      estimateContextTokensFromMessages([{ content: 'x'.repeat(8) }]),
    ).toBe(3)
  })

  it('counts text parts inside a structured content array', () => {
    const tokens = estimateContextTokensFromMessages([
      { content: [{ type: 'text', text: 'hello world' }] },
    ])
    // 'hello world' = 11 chars → ceil(11/3.5)=4
    expect(tokens).toBe(4)
  })

  it('JSON-stringifies array parts that lack a text field', () => {
    const tokens = estimateContextTokensFromMessages([
      { content: [{ type: 'image', data: 'abc' }] },
    ])
    expect(tokens).toBeGreaterThan(0)
  })

  it('treats null / non-object array parts as empty strings', () => {
    // [null, 42, 'primitive'] → ['', '', ''] → join(' ') = '  ' (2 spaces) → ceil(2/3.5)=1
    expect(
      estimateContextTokensFromMessages([
        { content: [null, 42, 'ignored-primitive'] },
      ]),
    ).toBe(1)
    // single null element → '' → 0 chars
    expect(estimateContextTokensFromMessages([{ content: [null] }])).toBe(0)
  })

  it('JSON-stringifies a plain object content', () => {
    const tokens = estimateContextTokensFromMessages([
      { content: { foo: 'bar', n: 1 } },
    ])
    // JSON.stringify({foo:'bar',n:1}) = '{"foo":"bar","n":1}' = 19 chars → 6
    expect(tokens).toBe(6)
  })

  it('counts top-level text when there is no content', () => {
    const tokens = estimateContextTokensFromMessages([{ text: 'x'.repeat(35) }])
    expect(tokens).toBe(10)
  })

  it('adds top-level text to string content when they differ', () => {
    const tokens = estimateContextTokensFromMessages([
      { content: 'aaaaaaa', text: 'bbbbbbb' },
    ])
    // 7 + 7 = 14 chars → 4
    expect(tokens).toBe(4)
  })

  it('does not double-count top-level text when it equals string content', () => {
    const both = estimateContextTokensFromMessages([
      { content: 'same-text', text: 'same-text' },
    ])
    const contentOnly = estimateContextTokensFromMessages([
      { content: 'same-text' },
    ])
    expect(both).toBe(contentOnly)
  })

  it('does not double-count top-level text when it mirrors structured content', () => {
    const mirrored = JSON.stringify({ output: 'x'.repeat(400) })
    const withText = estimateContextTokensFromMessages([
      { content: [{ type: 'tool_result', text: mirrored }], text: mirrored },
    ])
    const contentOnly = estimateContextTokensFromMessages([
      { content: [{ type: 'tool_result', text: mirrored }] },
    ])
    expect(withText).toBe(contentOnly)
  })

  it('adds top-level text to structured content when they differ', () => {
    const structuredOnly = estimateContextTokensFromMessages([
      { content: [{ type: 'text', text: 'structured' }] },
    ])
    const withExtra = estimateContextTokensFromMessages([
      {
        content: [{ type: 'text', text: 'structured' }],
        text: 'extra-distinct-text',
      },
    ])
    expect(withExtra).toBeGreaterThan(structuredOnly)
  })

  it('counts reasoning text', () => {
    const tokens = estimateContextTokensFromMessages([
      { reasoning: 'r'.repeat(35) },
    ])
    expect(tokens).toBe(10)
  })

  it('counts serialized tool_calls', () => {
    const tokens = estimateContextTokensFromMessages([
      { tool_calls: [{ name: 'do_thing', args: { a: 1 } }] },
    ])
    expect(tokens).toBeGreaterThan(0)
  })

  it('ignores non-string text / reasoning fields', () => {
    const tokens = estimateContextTokensFromMessages([
      { text: 12345, reasoning: { nested: true } },
    ])
    expect(tokens).toBe(0)
  })

  it('handles a message with no recognised fields as 0 chars', () => {
    expect(estimateContextTokensFromMessages([{}])).toBe(0)
  })
})

// ───────────────────────────────────────────────────────────────────────
// estimateContextTokensFromCacheRead
// ───────────────────────────────────────────────────────────────────────

describe('estimateContextTokensFromCacheRead', () => {
  it('divides cache-read tokens across assistant turns and applies a 1.2x factor', () => {
    // messageCount 10 → assistantTurns = ceil(10/2) = 5
    // 5000 / 5 * 1.2 = 1200
    expect(estimateContextTokensFromCacheRead(5000, 10)).toBe(1200)
  })

  it('uses a minimum of one assistant turn when messageCount is 0', () => {
    // assistantTurns = max(1, ceil(0/2)) = 1 → 1000 * 1.2 = 1200
    expect(estimateContextTokensFromCacheRead(1000, 0)).toBe(1200)
  })

  it('clamps negative cache-read tokens to 0', () => {
    expect(estimateContextTokensFromCacheRead(-500, 4)).toBe(0)
  })

  it('coerces non-finite inputs to 0', () => {
    expect(estimateContextTokensFromCacheRead(Number.NaN, 4)).toBe(0)
    expect(estimateContextTokensFromCacheRead(100, Number.NaN)).toBe(120)
  })

  it('rounds the result up', () => {
    // messageCount 3 → ceil(3/2)=2 turns; 100/2*1.2 = 60 (exact)
    expect(estimateContextTokensFromCacheRead(100, 3)).toBe(60)
    // 101/2*1.2 = 60.6 → 61
    expect(estimateContextTokensFromCacheRead(101, 3)).toBe(61)
  })
})

// ───────────────────────────────────────────────────────────────────────
// readContextUsage — live gateway runtime snapshot
// ───────────────────────────────────────────────────────────────────────

describe('readContextUsage: gateway runtime snapshot', () => {
  it('prefers the live runtime endpoint', async () => {
    withVanillaGateway()
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          model: 'claude-sonnet-4-5',
          context_tokens: 4321,
          context_length: 200000,
          context_percent: 2,
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await readContextUsage('session-123')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8642/api/sessions/session-123/runtime',
      expect.objectContaining({ headers: {}, signal: expect.any(AbortSignal) }),
    )
    expect(snapshot).toMatchObject({
      ok: true,
      model: 'claude-sonnet-4-5',
      usedTokens: 4321,
      maxTokens: 200000,
      contextPercent: 2,
      conversationTokens: 4321,
      staticTokens: 0,
    })
  })

  it('computes contextPercent from used/max when the endpoint omits a percent', async () => {
    withVanillaGateway()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            model: 'gpt-4o',
            context_tokens: 64000,
            context_length: 128000,
          }),
        ),
      ),
    )

    const snapshot = await readContextUsage('s1')
    // 64000/128000 = 50%
    expect(snapshot.contextPercent).toBe(50)
  })

  it('falls back through prompt/input/total token fields when context_tokens is absent', async () => {
    withVanillaGateway()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            model: 'gpt-4o',
            context_length: 128000,
            total_tokens: 9000,
          }),
        ),
      ),
    )

    const snapshot = await readContextUsage('s1')
    expect(snapshot.usedTokens).toBe(9000)
  })

  it('falls back to local estimation when runtime response is all-empty (returns null)', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/runtime')) {
          return Promise.resolve(jsonResponse({}))
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }),
    )

    const snapshot = await readContextUsage('s1')
    // empty runtime → null → no local data → configured empty snapshot
    expect(snapshot.usedTokens).toBe(0)
  })

  it('ignores a non-ok runtime response', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))),
    )

    const snapshot = await readContextUsage('s1')
    expect(snapshot.ok).toBe(true)
    expect(snapshot.usedTokens).toBe(0)
  })
})

// ───────────────────────────────────────────────────────────────────────
// readContextUsage — "main" session resolution
// ───────────────────────────────────────────────────────────────────────

describe('readContextUsage: main resolution', () => {
  it('resolves "main" to the canonical session id before reading runtime', async () => {
    withVanillaGateway()
    vi.mocked(listSessions).mockResolvedValue([
      { id: 'session-abc', title: 'Live chat', message_count: 12 },
    ])
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/sessions/session-abc/runtime')) {
        return Promise.resolve(
          jsonResponse({
            model: 'gpt-5.4',
            context_tokens: 86397,
            context_length: 512000,
            context_percent: 17,
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await readContextUsage('main')

    expect(listSessions).toHaveBeenCalledWith(30, 0)
    expect(snapshot).toMatchObject({
      model: 'gpt-5.4',
      usedTokens: 86397,
      maxTokens: 512000,
      contextPercent: 17,
    })
  })

  it('keeps "main" verbatim when bound to a portable dashboard session', async () => {
    // dashboard available + NOT enhancedChat → shouldBindMainToPortableSession = true
    withDashboard({ enhancedChat: false })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/sessions/main/runtime')) {
        return Promise.resolve(
          jsonResponse({
            model: 'gpt-5.4',
            context_tokens: 100,
            context_length: 512000,
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(dashboardFetch).mockResolvedValue(
      jsonResponse({ model: 'gpt-5.4', effective_context_length: 512000 }),
    )

    const snapshot = await readContextUsage('main')

    // listSessions should NOT have been consulted for the runtime id
    expect(snapshot.usedTokens).toBe(100)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8642/api/sessions/main/runtime',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('falls back to verbatim "main" when listSessions throws', async () => {
    withVanillaGateway()
    vi.mocked(listSessions).mockRejectedValue(new Error('offline'))
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )

    const snapshot = await readContextUsage('main')
    expect(snapshot.ok).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────
// readContextUsage — local session estimation
// ───────────────────────────────────────────────────────────────────────

describe('readContextUsage: local session estimation', () => {
  it('estimates from local messages and prefers the configured dashboard context length', async () => {
    withDashboard()
    vi.mocked(getLocalSession).mockReturnValue(
      mockLocalSession({ id: 'local-1', model: null }),
    )
    vi.mocked(getLocalMessages).mockReturnValue([
      mockLocalMessage({ content: 'x'.repeat(700) }),
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )
    vi.mocked(dashboardFetch).mockResolvedValue(
      jsonResponse({ model: 'gpt-5.4', config_context_length: 512000 }),
    )

    const snapshot = await readContextUsage('local-1')

    expect(snapshot).toMatchObject({
      model: 'gpt-5.4',
      maxTokens: 512000,
      usedTokens: 200, // 700/3.5
      contextPercent: 0,
    })
  })

  it("uses the local session's own model and its context window when no config", async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(
      mockLocalSession({ id: 'local-2', model: 'kimi-k2.6' }),
    )
    vi.mocked(getLocalMessages).mockReturnValue([
      mockLocalMessage({ content: 'hello' }),
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )
    vi.mocked(dashboardFetch).mockResolvedValue(
      new Response('no info', { status: 404 }),
    )

    const snapshot = await readContextUsage('local-2')
    expect(snapshot.model).toBe('kimi-k2.6')
    expect(snapshot.maxTokens).toBe(256000)
  })

  it('defaults the model to gpt-5.4 when neither local nor config supplies one', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(
      mockLocalSession({ id: 'local-3', model: null }),
    )
    vi.mocked(getLocalMessages).mockReturnValue([
      mockLocalMessage({ content: 'hi' }),
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )
    vi.mocked(dashboardFetch).mockResolvedValue(
      new Response('no info', { status: 404 }),
    )

    const snapshot = await readContextUsage('local-3')
    expect(snapshot.model).toBe('gpt-5.4')
    expect(snapshot.maxTokens).toBe(1000000)
  })

  it('appends in-flight assistant text from an active run before estimating', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(
      mockLocalSession({ id: 'local-run', model: 'gpt-4o' }),
    )
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.mocked(getActiveRunForSession).mockResolvedValue(
      mockActiveRun({ assistantText: 'a'.repeat(350) }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )
    vi.mocked(dashboardFetch).mockResolvedValue(
      new Response('no info', { status: 404 }),
    )

    const snapshot = await readContextUsage('local-run')
    // assistantText is set as both content and text but equal → counted once: 350/3.5 = 100
    expect(snapshot.usedTokens).toBe(100)
  })

  it('prefers a mirrored runtime session when one matches the local chat', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(
      mockLocalSession({
        id: 'local-mirror',
        model: null,
        createdAt: 1_000_000,
        updatedAt: 2_000_000,
      }),
    )
    vi.mocked(getLocalMessages).mockReturnValue([
      mockLocalMessage({ role: 'user', content: 'hello' }),
      mockLocalMessage({ role: 'assistant', content: 'world' }),
    ])
    const sessions: Array<ClaudeSession> = [
      {
        id: 'runtime-nearest',
        started_at: 2000.01,
        last_active: 2100,
        message_count: 0,
      },
      {
        id: 'runtime-older',
        started_at: 1800,
        last_active: 1900,
        message_count: 12,
      },
    ]
    vi.mocked(listSessions).mockResolvedValue(sessions)
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/sessions/local-mirror/runtime')) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        if (url.includes('/api/sessions/runtime-nearest/runtime')) {
          return Promise.resolve(
            jsonResponse({
              model: 'gpt-5.4',
              context_tokens: 85028,
              context_length: 512000,
              context_percent: 17,
            }),
          )
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }),
    )

    const snapshot = await readContextUsage('local-mirror')
    expect(snapshot).toMatchObject({
      model: 'gpt-5.4',
      usedTokens: 85028,
      contextPercent: 17,
    })
  })

  it('does not attempt mirror resolution with fewer than two comparable turns', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(
      mockLocalSession({ id: 'local-thin', model: 'gpt-4o' }),
    )
    vi.mocked(getLocalMessages).mockReturnValue([
      mockLocalMessage({ role: 'user', content: 'only one' }),
    ])
    const listSpy = vi.mocked(listSessions).mockResolvedValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )

    await readContextUsage('local-thin')
    // mirror resolution short-circuits before listing sessions
    expect(listSpy).not.toHaveBeenCalled()
  })
})

// ───────────────────────────────────────────────────────────────────────
// readContextUsage — pending-only (messages but no local session row)
// ───────────────────────────────────────────────────────────────────────

describe('readContextUsage: pending messages without a stored session', () => {
  it('estimates from local messages even when getLocalSession is null', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([
      mockLocalMessage({ content: 'x'.repeat(700) }),
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )

    const snapshot = await readContextUsage('pending-1')
    expect(snapshot.usedTokens).toBe(200)
    expect(snapshot.model).toBe('gpt-5.4')
  })

  it('estimates from active-run assistant text when there are no stored messages', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.mocked(getActiveRunForSession).mockResolvedValue(
      mockActiveRun({ assistantText: 'a'.repeat(350) }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )

    const snapshot = await readContextUsage('pending-run')
    expect(snapshot.usedTokens).toBe(100)
  })
})

// ───────────────────────────────────────────────────────────────────────
// readContextUsage — remote session metadata (cache-read & message fetch)
// ───────────────────────────────────────────────────────────────────────

describe('readContextUsage: remote session metadata', () => {
  it('estimates from cache_read_tokens when present (vanilla gateway)', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/runtime')) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        if (url.endsWith('/api/sessions/remote-1')) {
          return Promise.resolve(
            jsonResponse({
              session: {
                model: 'claude-opus-4-6',
                cache_read_tokens: 5000,
                message_count: 10,
              },
            }),
          )
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }),
    )

    const snapshot = await readContextUsage('remote-1')
    // 5000 / ceil(10/2)=5 * 1.2 = 1200
    expect(snapshot.usedTokens).toBe(1200)
    expect(snapshot.model).toBe('claude-opus-4-6')
    expect(snapshot.maxTokens).toBe(200000)
  })

  it('fetches messages and estimates when there are no cache-read tokens', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/runtime')) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        if (url.endsWith('/api/sessions/remote-2/messages')) {
          return Promise.resolve(
            jsonResponse({ items: [{ content: 'x'.repeat(700) }] }),
          )
        }
        if (url.endsWith('/api/sessions/remote-2')) {
          return Promise.resolve(
            jsonResponse({
              session: {
                id: 'remote-2',
                model: 'gpt-4o',
                cache_read_tokens: 0,
                message_count: 4,
              },
            }),
          )
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }),
    )

    const snapshot = await readContextUsage('remote-2')
    expect(snapshot.usedTokens).toBe(200) // 700/3.5
    expect(snapshot.model).toBe('gpt-4o')
  })

  it('reads dashboard-shaped session + messages payloads when dashboard is available', async () => {
    withDashboard()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )
    vi.mocked(dashboardFetch).mockImplementation((path: string) => {
      if (path === '/api/model/info') {
        return Promise.resolve(new Response('no info', { status: 404 }))
      }
      if (path.endsWith('/messages')) {
        return Promise.resolve(
          jsonResponse({ messages: [{ content: 'y'.repeat(350) }] }),
        )
      }
      if (path === '/api/sessions/dash-1') {
        // dashboard payload is used directly (no `.session` unwrap)
        return Promise.resolve(
          jsonResponse({
            id: 'dash-1',
            model: 'gpt-4o',
            cache_read_tokens: 0,
            message_count: 2,
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const snapshot = await readContextUsage('dash-1')
    expect(snapshot.usedTokens).toBe(100) // 350/3.5
    expect(snapshot.model).toBe('gpt-4o')
  })

  it('clamps used tokens to the model context window', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/runtime')) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        if (url.endsWith('/api/sessions/huge')) {
          return Promise.resolve(
            jsonResponse({
              session: {
                model: 'gpt-4o', // 128k window
                cache_read_tokens: 10_000_000_000,
                message_count: 2,
              },
            }),
          )
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }),
    )

    const snapshot = await readContextUsage('huge')
    expect(snapshot.usedTokens).toBe(128000)
    expect(snapshot.contextPercent).toBe(100)
  })

  it('returns the configured empty snapshot when the session is found nowhere', async () => {
    withDashboard()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )
    vi.mocked(dashboardFetch).mockImplementation((path: string) => {
      if (path === '/api/model/info') {
        return Promise.resolve(
          jsonResponse({ model: 'gpt-5.4', context_length: 512000 }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const snapshot = await readContextUsage('ghost')
    expect(snapshot).toMatchObject({
      ok: true,
      model: 'gpt-5.4',
      maxTokens: 512000,
      usedTokens: 0,
      contextPercent: 0,
      conversationTokens: 0,
    })
  })
})

// ───────────────────────────────────────────────────────────────────────
// readContextUsage — empty / configured snapshots
// ───────────────────────────────────────────────────────────────────────

describe('readContextUsage: configured / empty snapshots', () => {
  it('returns the configured empty snapshot for an empty session id', async () => {
    withDashboard()
    vi.mocked(dashboardFetch).mockResolvedValue(
      jsonResponse({ model: 'gpt-5.4', auto_context_length: 384000 }),
    )

    const snapshot = await readContextUsage('')
    expect(snapshot).toMatchObject({
      ok: true,
      model: 'gpt-5.4',
      maxTokens: 384000,
      usedTokens: 0,
      contextPercent: 0,
    })
  })

  it('returns a zeroed snapshot when no model info is configured at all', async () => {
    withVanillaGateway()
    vi.mocked(dashboardFetch).mockResolvedValue(
      new Response('no info', { status: 404 }),
    )

    const snapshot = await readContextUsage('')
    expect(snapshot).toMatchObject({
      ok: true,
      model: '',
      maxTokens: 0,
      usedTokens: 0,
    })
  })

  it('reads context_window from the capabilities sub-object of model info', async () => {
    withDashboard()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )
    vi.mocked(dashboardFetch).mockImplementation((path: string) => {
      if (path === '/api/model/info') {
        return Promise.resolve(
          jsonResponse({
            model: 'custom-model',
            capabilities: { context_window: 777000 },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const snapshot = await readContextUsage('ghost')
    expect(snapshot.maxTokens).toBe(777000)
    expect(snapshot.model).toBe('custom-model')
  })

  it('treats model info as absent when model-info fetch is not ok', async () => {
    withDashboard()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )
    vi.mocked(dashboardFetch).mockResolvedValue(
      new Response('err', { status: 500 }),
    )

    const snapshot = await readContextUsage('ghost')
    expect(snapshot.maxTokens).toBe(0)
    expect(snapshot.model).toBe('')
  })

  it('skips model info entirely when the dashboard is unavailable', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )

    const snapshot = await readContextUsage('ghost')
    expect(dashboardFetch).not.toHaveBeenCalled()
    expect(snapshot.usedTokens).toBe(0)
  })
})

// ───────────────────────────────────────────────────────────────────────
// readContextUsage — model window fuzzy matching & catastrophic failure
// ───────────────────────────────────────────────────────────────────────

describe('readContextUsage: model window matching', () => {
  it('matches a model window by substring when there is no exact key', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/runtime')) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        if (url.endsWith('/api/sessions/sub')) {
          return Promise.resolve(
            jsonResponse({
              session: {
                model: 'anthropic/claude-sonnet-4-5-20250101',
                cache_read_tokens: 100,
                message_count: 2,
              },
            }),
          )
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }),
    )

    const snapshot = await readContextUsage('sub')
    expect(snapshot.maxTokens).toBe(200000)
  })

  it('defaults to a 200k window for unknown models', async () => {
    withVanillaGateway()
    vi.mocked(getLocalSession).mockReturnValue(null)
    vi.mocked(getLocalMessages).mockReturnValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/runtime')) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        if (url.endsWith('/api/sessions/unknown')) {
          return Promise.resolve(
            jsonResponse({
              session: {
                model: 'totally-made-up-xyz',
                cache_read_tokens: 100,
                message_count: 2,
              },
            }),
          )
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }),
    )

    const snapshot = await readContextUsage('unknown')
    expect(snapshot.maxTokens).toBe(200000)
  })

  it('returns the catastrophic-failure fallback when ensureGatewayProbed throws', async () => {
    vi.mocked(ensureGatewayProbed).mockRejectedValue(new Error('probe failed'))

    const snapshot = await readContextUsage('anything')
    expect(snapshot).toMatchObject({
      ok: true,
      maxTokens: 128000,
      usedTokens: 0,
      model: '',
      contextPercent: 0,
      conversationTokens: 0,
    })
  })
})
