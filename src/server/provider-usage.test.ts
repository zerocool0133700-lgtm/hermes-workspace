import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchClaudeUsage,
  fetchCodexUsage,
  fetchGeminiUsage,
  fetchOpenAIUsage,
  fetchOpenRouterUsage,
  getProviderUsage,
} from './provider-usage'
import type { ProviderUsageResult } from './provider-usage'

// ── fs / child_process mocks ──────────────────────────────────────────────────

const fsState: {
  files: Map<string, string>
  writes: Map<string, string>
  readError?: Error
} = {
  files: new Map(),
  writes: new Map(),
}

vi.mock('node:fs', () => ({
  existsSync: (p: string): boolean => fsState.files.has(p),
  readFileSync: (p: string): string => {
    if (fsState.readError) throw fsState.readError
    const v = fsState.files.get(p)
    if (v === undefined) throw new Error(`ENOENT: ${p}`)
    return v
  },
  writeFileSync: (p: string, data: string): void => {
    fsState.writes.set(p, data)
  },
}))

const execState: { fn?: (cmd: string) => string } = {}

vi.mock('node:child_process', () => ({
  execSync: (cmd: string): string => {
    if (!execState.fn) throw new Error('no keychain')
    return execState.fn(cmd)
  },
}))

vi.mock('node:os', () => ({
  homedir: (): string => '/home/tester',
}))

const CLAUDE_CRED_PATH = '/home/tester/.claude/.credentials.json'
const CODEX_AUTH_PATH = '/home/tester/.codex/auth.json'

// ── helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
}

function lineByLabel(
  result: ProviderUsageResult,
  label: string,
): ProviderUsageResult['lines'][number] | undefined {
  return result.lines.find((l) => l.label === label)
}

const FIXED_NOW = 1_700_000_000_000

const ORIGINAL_PLATFORM = process.platform

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
  })
}

beforeEach(() => {
  fsState.files.clear()
  fsState.writes.clear()
  fsState.readError = undefined
  execState.fn = undefined
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENROUTER_API_KEY
  delete process.env.GOOGLE_API_KEY
  // default platform: linux (no keychain) unless a test overrides
  setPlatform('linux')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setPlatform(ORIGINAL_PLATFORM)
})

// ── Claude ─────────────────────────────────────────────────────────────────────

describe('fetchClaudeUsage', () => {
  function writeClaudeCreds(oauth: Record<string, unknown>): void {
    fsState.files.set(
      CLAUDE_CRED_PATH,
      JSON.stringify({ claudeAiOauth: oauth }),
    )
  }

  it('returns missing_credentials when no file and no keychain', async () => {
    const result = await fetchClaudeUsage()
    expect(result.provider).toBe('claude')
    expect(result.status).toBe('missing_credentials')
    expect(result.lines).toEqual([])
    expect(result.updatedAt).toBe(FIXED_NOW)
  })

  it('parses five_hour, seven_day, sonnet utilization into progress lines', async () => {
    writeClaudeCreds({ accessToken: 'tok', subscriptionType: 'claude_max_20x' })
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        five_hour: { utilization: 42, resets_at: '2026-01-01T00:00:00Z' },
        seven_day: { utilization: 10 },
        seven_day_sonnet: { utilization: 5 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchClaudeUsage()

    expect(result.status).toBe('ok')
    expect(result.plan).toBe('Max 20x')
    const session = lineByLabel(result, 'Session (5h)')
    expect(session).toMatchObject({
      type: 'progress',
      used: 42,
      limit: 100,
      format: 'percent',
    })
    expect(session?.resetsAt).toBe('2026-01-01T00:00:00.000Z')
    expect(lineByLabel(result, 'Weekly')?.used).toBe(10)
    expect(lineByLabel(result, 'Sonnet')?.used).toBe(5)
  })

  it('converts extra_usage cents to dollars as a progress line', async () => {
    writeClaudeCreds({ accessToken: 'tok' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          extra_usage: {
            is_enabled: true,
            used_credits: 250,
            monthly_limit: 1000,
          },
        }),
      ),
    )

    const result = await fetchClaudeUsage()
    expect(lineByLabel(result, 'Extra Usage')).toMatchObject({
      type: 'progress',
      used: 2.5,
      limit: 10,
      format: 'dollars',
    })
  })

  it('renders extra_usage as text when there is no positive limit', async () => {
    writeClaudeCreds({ accessToken: 'tok' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          extra_usage: {
            is_enabled: true,
            used_credits: 500,
            monthly_limit: 0,
          },
        }),
      ),
    )

    const result = await fetchClaudeUsage()
    expect(lineByLabel(result, 'Extra Usage')).toMatchObject({
      type: 'text',
      value: '$5.00',
    })
  })

  it('emits a "No usage data" badge when payload yields no lines', async () => {
    writeClaudeCreds({ accessToken: 'tok' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))

    const result = await fetchClaudeUsage()
    expect(result.status).toBe('ok')
    expect(result.lines).toEqual([
      {
        type: 'badge',
        label: 'Status',
        value: 'No usage data',
        color: '#a3a3a3',
      },
    ])
  })

  it('returns error status on non-ok HTTP', async () => {
    writeClaudeCreds({ accessToken: 'tok' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 500 })),
    )

    const result = await fetchClaudeUsage()
    expect(result.status).toBe('error')
    expect(result.message).toBe('HTTP 500')
  })

  it('returns error status when fetch throws', async () => {
    writeClaudeCreds({ accessToken: 'tok' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))

    const result = await fetchClaudeUsage()
    expect(result.status).toBe('error')
    expect(result.message).toBe('Request failed: boom')
  })

  it('returns error when response body is not valid JSON', async () => {
    writeClaudeCreds({ accessToken: 'tok' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('not-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await fetchClaudeUsage()
    expect(result.status).toBe('error')
    expect(result.message).toBe('Invalid response')
  })

  it('refreshes an expiring token before fetching usage', async () => {
    writeClaudeCreds({
      accessToken: 'old',
      refreshToken: 'refresh',
      expiresAt: FIXED_NOW + 1000, // within REFRESH_BUFFER_MS
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'new', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchClaudeUsage()
    expect(result.status).toBe('ok')
    // The usage fetch (2nd call) must carry the refreshed token.
    const usageHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >
    expect(usageHeaders.Authorization).toBe('Bearer new')
    // Refreshed creds are persisted to disk.
    expect(fsState.writes.has(CLAUDE_CRED_PATH)).toBe(true)
  })

  it('maps invalid_grant refresh failure to auth_expired with session message', async () => {
    writeClaudeCreds({
      accessToken: 'old',
      refreshToken: 'refresh',
      expiresAt: FIXED_NOW - 1,
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: 'invalid_grant' }, { status: 400 }),
        ),
    )

    const result = await fetchClaudeUsage()
    expect(result.status).toBe('auth_expired')
    expect(result.message).toContain('session expired')
  })

  it('retries once with a refreshed token after a 401 on the usage call', async () => {
    writeClaudeCreds({ accessToken: 'old', refreshToken: 'refresh' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 })) // usage call
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'fresh', expires_in: 3600 }),
      ) // refresh
      .mockResolvedValueOnce(jsonResponse({ five_hour: { utilization: 7 } })) // retry usage
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchClaudeUsage()
    expect(result.status).toBe('ok')
    expect(lineByLabel(result, 'Session (5h)')?.used).toBe(7)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('falls back gracefully when credentials file is malformed JSON', async () => {
    fsState.files.set(CLAUDE_CRED_PATH, '{ broken')
    const result = await fetchClaudeUsage()
    expect(result.status).toBe('missing_credentials')
  })

  it('loads credentials from the macOS keychain when no file exists', async () => {
    setPlatform('darwin')
    execState.fn = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: 'kc-token' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))

    const result = await fetchClaudeUsage()
    expect(result.status).toBe('ok')
  })

  it('decodes hex-encoded keychain payloads', async () => {
    setPlatform('darwin')
    const payload = JSON.stringify({
      claudeAiOauth: { accessToken: 'hex-token' },
    })
    const hex = Buffer.from(payload, 'utf-8').toString('hex')
    execState.fn = () => hex
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))

    const result = await fetchClaudeUsage()
    expect(result.status).toBe('ok')
  })
})

// ── Codex ──────────────────────────────────────────────────────────────────────

describe('fetchCodexUsage', () => {
  function writeCodexAuth(auth: Record<string, unknown>): void {
    fsState.files.set(CODEX_AUTH_PATH, JSON.stringify(auth))
  }

  it('returns missing_credentials when auth file is absent', async () => {
    const result = await fetchCodexUsage()
    expect(result.provider).toBe('codex')
    expect(result.status).toBe('missing_credentials')
  })

  it('returns missing_credentials when access token is absent', async () => {
    writeCodexAuth({ tokens: {} })
    const result = await fetchCodexUsage()
    expect(result.status).toBe('missing_credentials')
  })

  it('prefers header percentages over body and maps plan_type', async () => {
    writeCodexAuth({
      tokens: { access_token: 'tok', account_id: 'acct-1' },
      last_refresh: new Date(FIXED_NOW).toISOString(),
    })
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          plan_type: 'pro',
          rate_limit: {
            primary_window: { used_percent: 99, reset_at: 1_700_000_500 },
            secondary_window: { used_percent: 50 },
          },
        },
        {
          headers: {
            'x-codex-primary-used-percent': '33',
            'x-codex-secondary-used-percent': '12',
          },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchCodexUsage()
    expect(result.status).toBe('ok')
    expect(result.plan).toBe('Pro')
    expect(lineByLabel(result, 'Session')?.used).toBe(33)
    expect(lineByLabel(result, 'Weekly')?.used).toBe(12)
    // reset_at (absolute seconds) -> ISO
    expect(lineByLabel(result, 'Session')?.resetsAt).toBe(
      new Date(1_700_000_500 * 1000).toISOString(),
    )
    // account id header propagated
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >
    expect(headers['ChatGPT-Account-Id']).toBe('acct-1')
  })

  it('falls back to body used_percent when headers are absent', async () => {
    writeCodexAuth({
      tokens: { access_token: 'tok' },
      last_refresh: new Date(FIXED_NOW).toISOString(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          rate_limit: {
            primary_window: { used_percent: 80, reset_after_seconds: 60 },
            secondary_window: { used_percent: 20 },
          },
        }),
      ),
    )

    const result = await fetchCodexUsage()
    expect(lineByLabel(result, 'Session')?.used).toBe(80)
    expect(lineByLabel(result, 'Weekly')?.used).toBe(20)
    // reset_after_seconds -> now + offset
    const nowSec = Math.floor(FIXED_NOW / 1000)
    expect(lineByLabel(result, 'Session')?.resetsAt).toBe(
      new Date((nowSec + 60) * 1000).toISOString(),
    )
  })

  it('renders review window and credits from body', async () => {
    writeCodexAuth({
      tokens: { access_token: 'tok' },
      last_refresh: new Date(FIXED_NOW).toISOString(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          code_review_rate_limit: { primary_window: { used_percent: 5 } },
          credits: { balance: 400 },
        }),
      ),
    )

    const result = await fetchCodexUsage()
    expect(lineByLabel(result, 'Reviews')?.used).toBe(5)
    const credits = lineByLabel(result, 'Credits')
    expect(credits).toMatchObject({
      type: 'progress',
      limit: 1000,
      format: 'tokens',
    })
    // used = limit - remaining = 1000 - 400
    expect(credits?.used).toBe(600)
  })

  it('clamps credits used between 0 and limit when balance exceeds limit', async () => {
    writeCodexAuth({
      tokens: { access_token: 'tok' },
      last_refresh: new Date(FIXED_NOW).toISOString(),
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({}, { headers: { 'x-codex-credits-balance': '5000' } }),
        ),
    )

    const result = await fetchCodexUsage()
    // remaining 5000 > limit 1000 -> used clamped to 0
    expect(lineByLabel(result, 'Credits')?.used).toBe(0)
  })

  it('emits "No usage data" badge when nothing parseable is present', async () => {
    writeCodexAuth({
      tokens: { access_token: 'tok' },
      last_refresh: new Date(FIXED_NOW).toISOString(),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))

    const result = await fetchCodexUsage()
    expect(result.lines).toEqual([
      {
        type: 'badge',
        label: 'Status',
        value: 'No usage data',
        color: '#a3a3a3',
      },
    ])
  })

  it('refreshes a stale token before the usage call', async () => {
    // last_refresh older than CODEX_REFRESH_AGE_MS (8 days)
    writeCodexAuth({
      tokens: { access_token: 'old', refresh_token: 'r' },
      last_refresh: new Date(FIXED_NOW - 9 * 24 * 60 * 60 * 1000).toISOString(),
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'new-codex' }))
      .mockResolvedValueOnce(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchCodexUsage()
    expect(result.status).toBe('ok')
    const usageHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >
    expect(usageHeaders.Authorization).toBe('Bearer new-codex')
    expect(fsState.writes.has(CODEX_AUTH_PATH)).toBe(true)
  })

  it('maps refresh_token_expired to auth_expired', async () => {
    writeCodexAuth({
      tokens: { access_token: 'old', refresh_token: 'r' },
      last_refresh: new Date(FIXED_NOW - 9 * 24 * 60 * 60 * 1000).toISOString(),
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: { code: 'refresh_token_expired' } },
            { status: 401 },
          ),
        ),
    )

    const result = await fetchCodexUsage()
    expect(result.status).toBe('auth_expired')
    expect(result.message).toContain('session expired')
  })

  it('retries usage once after a 403, refreshing the token', async () => {
    writeCodexAuth({
      tokens: { access_token: 'old', refresh_token: 'r' },
      last_refresh: new Date(FIXED_NOW).toISOString(),
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 403 })) // usage
      .mockResolvedValueOnce(jsonResponse({ access_token: 'fresh' })) // refresh
      .mockResolvedValueOnce(
        jsonResponse({}, { headers: { 'x-codex-primary-used-percent': '1' } }),
      ) // retry
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchCodexUsage()
    expect(result.status).toBe('ok')
    expect(lineByLabel(result, 'Session')?.used).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('returns error on non-ok HTTP after exhausting refresh', async () => {
    writeCodexAuth({
      tokens: { access_token: 'tok' },
      last_refresh: new Date(FIXED_NOW).toISOString(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 500 })),
    )

    const result = await fetchCodexUsage()
    expect(result.status).toBe('error')
    expect(result.message).toBe('HTTP 500')
  })

  it('returns error when the request throws', async () => {
    writeCodexAuth({
      tokens: { access_token: 'tok' },
      last_refresh: new Date(FIXED_NOW).toISOString(),
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net down')))

    const result = await fetchCodexUsage()
    expect(result.status).toBe('error')
    expect(result.message).toBe('Request failed: net down')
  })
})

// ── OpenAI ──────────────────────────────────────────────────────────────────────

describe('fetchOpenAIUsage', () => {
  it('returns missing_credentials without OPENAI_API_KEY', async () => {
    const result = await fetchOpenAIUsage()
    expect(result.status).toBe('missing_credentials')
    expect(result.message).toBe('Missing OPENAI_API_KEY')
  })

  it('aggregates input/output tokens across buckets', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            { results: [{ input_tokens: 1_000_000, output_tokens: 500_000 }] },
            { results: [{ input_tokens: 1_000_000, output_tokens: 500_000 }] },
          ],
        }),
      ),
    )

    const result = await fetchOpenAIUsage()
    expect(result.status).toBe('ok')
    expect(lineByLabel(result, 'Input (30d)')?.value).toBe('2.00M tokens')
    expect(lineByLabel(result, 'Output (30d)')?.value).toBe('1.00M tokens')
  })

  it('reports "API key active" when usage endpoint returns 401', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 401 })),
    )

    const result = await fetchOpenAIUsage()
    expect(result.status).toBe('ok')
    expect(lineByLabel(result, 'Status')?.value).toBe('API key active')
  })

  it('falls back to a Connected badge when no token data present', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: [] })),
    )

    const result = await fetchOpenAIUsage()
    expect(lineByLabel(result, 'Status')?.value).toBe('Connected')
  })

  it('returns error on a non-ok, non-auth status', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 500 })),
    )

    const result = await fetchOpenAIUsage()
    expect(result.status).toBe('error')
    expect(result.message).toBe('HTTP 500')
  })

  it('returns error when the request throws', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('dns fail')))

    const result = await fetchOpenAIUsage()
    expect(result.status).toBe('error')
    expect(result.message).toBe('dns fail')
  })
})

// ── OpenRouter ──────────────────────────────────────────────────────────────────

describe('fetchOpenRouterUsage', () => {
  it('returns missing_credentials without OPENROUTER_API_KEY', async () => {
    const result = await fetchOpenRouterUsage()
    expect(result.status).toBe('missing_credentials')
    expect(result.message).toBe('Missing OPENROUTER_API_KEY')
  })

  it('renders a spend progress bar when a positive limit exists', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            limit: 20,
            usage: { cost: 5, prompt_tokens: 1_000_000, completion_tokens: 0 },
          },
        }),
      ),
    )

    const result = await fetchOpenRouterUsage()
    expect(result.status).toBe('ok')
    expect(lineByLabel(result, 'Spend')).toMatchObject({
      type: 'progress',
      used: 5,
      limit: 20,
      format: 'dollars',
    })
    expect(lineByLabel(result, 'Tokens')?.value).toBe('1.00M total')
  })

  it('renders spend as text when no limit is configured', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ data: { usage: { cost: 3.5 } } })),
    )

    const result = await fetchOpenRouterUsage()
    expect(lineByLabel(result, 'Spend')).toMatchObject({
      type: 'text',
      value: '$3.50',
    })
    // no token line when totals are zero
    expect(lineByLabel(result, 'Tokens')).toBeUndefined()
  })

  it('reads top-level cost/limit fields when data has no usage object', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ cost: 7, spend_limit: 100 })),
    )

    const result = await fetchOpenRouterUsage()
    expect(lineByLabel(result, 'Spend')).toMatchObject({
      used: 7,
      limit: 100,
      format: 'dollars',
    })
  })

  it('returns error on non-ok HTTP', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 429 })),
    )

    const result = await fetchOpenRouterUsage()
    expect(result.status).toBe('error')
    expect(result.message).toBe('HTTP 429')
  })

  it('returns error when the request throws', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))

    const result = await fetchOpenRouterUsage()
    expect(result.status).toBe('error')
    expect(result.message).toBe('timeout')
  })
})

// ── Gemini ──────────────────────────────────────────────────────────────────────

describe('fetchGeminiUsage', () => {
  it('returns missing_credentials without GOOGLE_API_KEY', async () => {
    const result = await fetchGeminiUsage()
    expect(result.status).toBe('missing_credentials')
    expect(result.message).toBe('Missing GOOGLE_API_KEY')
  })

  it('reports ok with status badges on a successful models list', async () => {
    process.env.GOOGLE_API_KEY = 'g-test'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ models: [] })),
    )

    const result = await fetchGeminiUsage()
    expect(result.status).toBe('ok')
    expect(lineByLabel(result, 'Status')?.value).toBe('API key active')
    expect(lineByLabel(result, 'Usage data')?.value).toBe(
      'Not available via API',
    )
  })

  it('maps 403 to auth_expired', async () => {
    process.env.GOOGLE_API_KEY = 'g-test'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 403 })),
    )

    const result = await fetchGeminiUsage()
    expect(result.status).toBe('auth_expired')
    expect(result.message).toBe('Invalid or expired GOOGLE_API_KEY')
  })

  it('returns error on other non-ok HTTP', async () => {
    process.env.GOOGLE_API_KEY = 'g-test'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 500 })),
    )

    const result = await fetchGeminiUsage()
    expect(result.status).toBe('error')
    expect(result.message).toBe('HTTP 500')
  })

  it('returns error when the request throws', async () => {
    process.env.GOOGLE_API_KEY = 'g-test'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const result = await fetchGeminiUsage()
    expect(result.status).toBe('error')
    expect(result.message).toBe('offline')
  })
})

// ── Aggregate ───────────────────────────────────────────────────────────────────

describe('getProviderUsage', () => {
  it('aggregates all five providers and caches the result', async () => {
    // No credentials anywhere -> deterministic missing_credentials for all.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))

    const first = await getProviderUsage(true)
    expect(first.ok).toBe(true)
    expect(first.updatedAt).toBe(FIXED_NOW)
    expect(first.providers.map((p) => p.provider)).toEqual([
      'claude',
      'codex',
      'openai',
      'openrouter',
      'gemini',
    ])

    // Advance time but stay within the 30s cache TTL: cached payload returned.
    vi.setSystemTime(FIXED_NOW + 10_000)
    const cached = await getProviderUsage(false)
    expect(cached).toBe(first)

    // force=true bypasses the cache and recomputes with the new clock.
    const forced = await getProviderUsage(true)
    expect(forced).not.toBe(first)
    expect(forced.updatedAt).toBe(FIXED_NOW + 10_000)
  })

  it('recomputes once the cache TTL has elapsed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))
    const first = await getProviderUsage(true)

    vi.setSystemTime(FIXED_NOW + 31_000) // past CACHE_TTL_MS (30s)
    const next = await getProviderUsage(false)
    expect(next).not.toBe(first)
    expect(next.updatedAt).toBe(FIXED_NOW + 31_000)
  })
})
