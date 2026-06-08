/** @vitest-environment jsdom */
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOperationsSessionKey, useOperations } from './use-operations'
import type { ReactNode } from 'react'
import type { GatewaySession } from '@/lib/gateway-api'
import type { CronJob } from '@/components/cron-manager/cron-types'

// ---------------------------------------------------------------------------
// Module mocks
//
// useOperations is wired to four side-effecting collaborators:
//   - `@/lib/gateway-api`    (fetchSessions -> live session list)
//   - `@/lib/cron-api`       (fetchCronJobs -> scheduled jobs)
//   - `@/components/ui/toast`(toast notifications on mutation success/failure)
// plus raw `fetch` to the `/api/profiles/*` server routes (config + CRUD).
//
// We replace the api clients + toast with typed fakes, and stub `fetch` per
// test, so we can drive the hook's pure derivation/normalization logic (the
// `agents` / `recentActivity` / `defaultModel` memos) and observe the
// mutations' externally-visible effects (which endpoints they hit, what they
// persist to localStorage, how selection/error state changes).
// ---------------------------------------------------------------------------

const fetchSessionsMock =
  vi.fn<() => Promise<{ sessions?: Array<GatewaySession> }>>()
const fetchCronJobsMock = vi.fn<() => Promise<Array<CronJob>>>()
const toastMock = vi.fn<(message: string, opts?: { type?: string }) => void>()

vi.mock('@/lib/gateway-api', () => ({
  fetchSessions: () => fetchSessionsMock(),
}))

vi.mock('@/lib/cron-api', () => ({
  fetchCronJobs: () => fetchCronJobsMock(),
}))

vi.mock('@/components/ui/toast', () => ({
  toast: (message: string, opts?: { type?: string }) =>
    toastMock(message, opts),
}))

// ---------------------------------------------------------------------------
// Profile-route fetch stub
//
// The config query + all three mutations talk to `/api/profiles/*` via raw
// fetch. This builds a Response-like object that returns JSON with the
// `application/json` content-type the hook's fetchClaudeProfiles guard checks.
// ---------------------------------------------------------------------------

type ProfileSummary = {
  name: string
  path: string
  active: boolean
  exists: boolean
  model?: string
  description?: string
  systemPrompt?: string
  skillCount: number
  sessionCount: number
  hasEnv: boolean
}

function jsonResponse(
  body: unknown,
  init?: { ok?: boolean; status?: number },
): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

type ProfileRoutes = {
  list?: Array<ProfileSummary>
  listResponse?: Response
  create?: Response
  update?: Response
  delete?: Response
}

const fetchCalls: Array<{ url: string; body: unknown }> = []

/** Read + JSON-parse a recorded request body (the hook only sends strings). */
function readBody(
  call: { body: unknown } | undefined,
): Record<string, unknown> {
  const body = call?.body
  const parsed: unknown = typeof body === 'string' ? JSON.parse(body) : {}
  return parsed !== null && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>)
    : {}
}

/**
 * Install a fetch stub that routes `/api/profiles/*` paths to canned
 * responses and records every call for assertions.
 */
function stubProfileFetch(routes: ProfileRoutes): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString()
      fetchCalls.push({ url, body: init?.body })
      if (url.includes('/api/profiles/list')) {
        return Promise.resolve(
          routes.listResponse ?? jsonResponse({ profiles: routes.list ?? [] }),
        )
      }
      if (url.includes('/api/profiles/create')) {
        return Promise.resolve(routes.create ?? jsonResponse({ ok: true }))
      }
      if (url.includes('/api/profiles/update')) {
        return Promise.resolve(routes.update ?? jsonResponse({ ok: true }))
      }
      if (url.includes('/api/profiles/delete')) {
        return Promise.resolve(routes.delete ?? jsonResponse({ ok: true }))
      }
      return Promise.resolve(jsonResponse({}, { ok: false, status: 404 }))
    }),
  )
}

function makeWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

function renderOperations() {
  return renderHook(() => useOperations(), { wrapper: makeWrapper() })
}

function profile(
  over: Partial<ProfileSummary> & { name: string },
): ProfileSummary {
  return {
    path: `/p/${over.name}`,
    active: false,
    exists: true,
    skillCount: 0,
    sessionCount: 0,
    hasEnv: false,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchCalls.length = 0
  window.localStorage.clear()
  fetchSessionsMock.mockResolvedValue({ sessions: [] })
  fetchCronJobsMock.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Pure helper: getOperationsSessionKey
// ---------------------------------------------------------------------------

describe('getOperationsSessionKey', () => {
  it('namespaces an agent id into the ops session key', () => {
    expect(getOperationsSessionKey('writer')).toBe('agent:main:ops-writer')
  })
})

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('useOperations — initial state', () => {
  it('starts with no agents, no selection, and default settings', () => {
    stubProfileFetch({ list: [] })
    const { result } = renderOperations()

    expect(result.current.agents).toEqual([])
    expect(result.current.selectedAgent).toBeNull()
    expect(result.current.selectedAgentId).toBeNull()
    expect(result.current.settings).toEqual({
      defaultModel: '',
      autoApprove: false,
      activityFeedLength: 5,
    })
    expect(result.current.recentActivity).toEqual([])
    expect(typeof result.current.createAgent).toBe('function')
    expect(typeof result.current.saveAgent).toBe('function')
    expect(typeof result.current.deleteAgent).toBe('function')
  })

  it('hydrates settings from localStorage and clamps activityFeedLength', () => {
    window.localStorage.setItem(
      'operations-settings',
      JSON.stringify({
        defaultModel: 'anthropic/claude-opus-4-6',
        autoApprove: true,
        activityFeedLength: 99,
      }),
    )
    stubProfileFetch({ list: [] })
    const { result } = renderOperations()

    expect(result.current.settings.defaultModel).toBe(
      'anthropic/claude-opus-4-6',
    )
    expect(result.current.settings.autoApprove).toBe(true)
    // 99 is clamped to the [1, 20] window.
    expect(result.current.settings.activityFeedLength).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// Data loading + derivation
// ---------------------------------------------------------------------------

describe('useOperations — agent derivation', () => {
  it('loads profiles, renames "default" to "Workspace", and derives shortModel', async () => {
    stubProfileFetch({
      list: [
        profile({ name: 'default', model: 'anthropic/claude-opus-4-6' }),
        profile({ name: 'writer', model: 'anthropic/claude-sonnet-4-5' }),
      ],
    })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.agents).toHaveLength(2))

    const byId = new Map(result.current.agents.map((a) => [a.id, a]))
    expect(byId.get('default')?.name).toBe('Workspace')
    expect(byId.get('writer')?.name).toBe('writer')
    expect(byId.get('default')?.shortModel).toBe('Opus 4.6')
    expect(byId.get('writer')?.shortModel).toBe('Sonnet 4.5')
  })

  it('filters out hidden system/internal agents', async () => {
    stubProfileFetch({
      list: [
        profile({ name: 'main', model: 'm' }),
        profile({ name: 'pc1-coder', model: 'm' }),
        profile({ name: 'pc1-planner', model: 'm' }),
        profile({ name: 'pc1-critic', model: 'm' }),
        profile({ name: 'researcher', model: 'm' }),
      ],
    })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.agents).toHaveLength(1))
    expect(result.current.agents.at(0)?.id).toBe('researcher')
  })

  it('flags agents with a blank model as needsSetup', async () => {
    stubProfileFetch({
      list: [
        profile({ name: 'configured', model: 'anthropic/claude-opus-4-6' }),
        profile({ name: 'blank', model: '' }),
      ],
    })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.agents).toHaveLength(2))
    const byId = new Map(result.current.agents.map((a) => [a.id, a]))
    expect(byId.get('configured')?.needsSetup).toBe(false)
    expect(byId.get('blank')?.needsSetup).toBe(true)
    // Blank model still renders a placeholder short label.
    expect(byId.get('blank')?.shortModel).toBe('Custom')
  })

  it('exposes defaultModel from the default profile model', async () => {
    stubProfileFetch({
      list: [profile({ name: 'default', model: 'anthropic/claude-opus-4-6' })],
    })
    const { result } = renderOperations()

    await waitFor(() =>
      expect(result.current.defaultModel).toBe('anthropic/claude-opus-4-6'),
    )
  })

  it('falls back to settings.defaultModel when the config has none', async () => {
    window.localStorage.setItem(
      'operations-settings',
      JSON.stringify({ defaultModel: 'fallback-model' }),
    )
    stubProfileFetch({ list: [profile({ name: 'default', model: '' })] })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.agents).toHaveLength(1))
    expect(result.current.defaultModel).toBe('fallback-model')
  })
})

// ---------------------------------------------------------------------------
// Session/cron association + status derivation
// ---------------------------------------------------------------------------

describe('useOperations — status, sessions, jobs', () => {
  it('associates sessions by label/key match and marks recently-updated as active', async () => {
    const now = Date.now()
    fetchSessionsMock.mockResolvedValue({
      sessions: [
        {
          key: 'sess-writer-1',
          label: 'ops writer run',
          status: 'streaming',
          updatedAt: now - 1_000,
          lastMessage: { text: 'Drafting the report' },
        },
        {
          key: 'unrelated',
          label: 'something else',
          updatedAt: now,
          lastMessage: { text: 'nope' },
        },
      ],
    })
    stubProfileFetch({ list: [profile({ name: 'writer', model: 'm' })] })
    const { result } = renderOperations()

    await waitFor(() =>
      expect(result.current.agents.at(0)?.sessions).toHaveLength(1),
    )
    const agent = result.current.agents.at(0)
    expect(agent?.status).toBe('active')
    expect(agent?.progressStatus).toBe('running')
    expect(agent?.latestSession?.key).toBe('sess-writer-1')
    expect(agent?.recentOutputs.at(0)?.summary).toBe('Drafting the report')
    expect(agent?.recentOutputs.at(0)?.source).toBe('session')
  })

  it('marks a failed session status as error', async () => {
    fetchSessionsMock.mockResolvedValue({
      sessions: [
        {
          key: 'writer-fail',
          label: 'writer',
          status: 'failed',
          updatedAt: Date.now(),
          lastMessage: { text: 'boom' },
        },
      ],
    })
    stubProfileFetch({ list: [profile({ name: 'writer', model: 'm' })] })
    const { result } = renderOperations()

    await waitFor(() =>
      expect(result.current.agents.at(0)?.status).toBe('error'),
    )
    const agent = result.current.agents.at(0)
    expect(agent?.progressStatus).toBe('failed')
    expect(agent?.progressValue).toBe(100)
  })

  it('treats an old session as idle and reports a relative last-activity label', async () => {
    const old = Date.now() - 10 * 60_000
    fetchSessionsMock.mockResolvedValue({
      sessions: [
        {
          key: 'writer-old',
          label: 'writer',
          status: 'complete',
          updatedAt: old,
          lastMessage: { text: 'finished long ago' },
        },
      ],
    })
    stubProfileFetch({ list: [profile({ name: 'writer', model: 'm' })] })
    const { result } = renderOperations()

    await waitFor(() =>
      expect(result.current.agents.at(0)?.status).toBe('idle'),
    )
    const agent = result.current.agents.at(0)
    expect(agent?.progressStatus).toBe('complete')
    expect(agent?.lastActivityAt).toBe(old)
    expect(agent?.activityLabel.startsWith('Last')).toBe(true)
  })

  it('associates enabled cron jobs and surfaces the next upcoming run', async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString()
    const job: CronJob = {
      id: 'job1',
      name: 'ops:writer:daily-digest',
      schedule: '0 9 * * *',
      enabled: true,
      nextRunAt: future,
      lastRun: {
        id: 'run1',
        status: 'success',
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        finishedAt: new Date(Date.now() - 30_000).toISOString(),
        deliverySummary: 'Sent the digest',
      },
    }
    fetchCronJobsMock.mockResolvedValue([
      job,
      // belongs to a different agent — must not attach to writer
      { ...job, id: 'job2', name: 'ops:other:thing' },
    ])
    stubProfileFetch({ list: [profile({ name: 'writer', model: 'm' })] })
    const { result } = renderOperations()

    await waitFor(() =>
      expect(result.current.agents.at(0)?.jobs).toHaveLength(1),
    )
    const agent = result.current.agents.at(0)
    expect(agent?.jobs.at(0)?.id).toBe('job1')
    expect(agent?.nextRunAt).not.toBeNull()
    expect(agent?.activityLabel.startsWith('Next')).toBe(true)
    // The cron run becomes a recent output.
    const cronOutput = agent?.recentOutputs.find((o) => o.source === 'cron')
    expect(cronOutput?.summary).toBe('Sent the digest')
  })

  it('reports "No activity yet" when an agent has neither sessions nor jobs', async () => {
    stubProfileFetch({ list: [profile({ name: 'lonely', model: 'm' })] })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.agents).toHaveLength(1))
    const agent = result.current.agents.at(0)
    expect(agent?.status).toBe('idle')
    expect(agent?.progressStatus).toBe('queued')
    expect(agent?.activityLabel).toBe('No activity yet')
    expect(agent?.recentOutputs).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// recentActivity aggregation
// ---------------------------------------------------------------------------

describe('useOperations — recentActivity', () => {
  it('merges all agents’ outputs sorted newest-first and respects the feed length', async () => {
    window.localStorage.setItem(
      'operations-settings',
      JSON.stringify({ activityFeedLength: 2 }),
    )
    const base = Date.now()
    fetchSessionsMock.mockResolvedValue({
      sessions: [
        {
          key: 's-a',
          label: 'alpha',
          updatedAt: base - 3_000,
          lastMessage: { text: 'oldest' },
        },
        {
          key: 's-b',
          label: 'beta',
          updatedAt: base - 1_000,
          lastMessage: { text: 'newest' },
        },
        {
          key: 's-c',
          label: 'alpha',
          updatedAt: base - 2_000,
          lastMessage: { text: 'middle' },
        },
      ],
    })
    stubProfileFetch({
      list: [
        profile({ name: 'alpha', model: 'm' }),
        profile({ name: 'beta', model: 'm' }),
      ],
    })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.recentActivity).toHaveLength(2))
    const summaries = result.current.recentActivity.map((o) => o.summary)
    expect(summaries).toEqual(['newest', 'middle'])
  })
})

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe('useOperations — selection', () => {
  it('resolves selectedAgent from selectedAgentId', async () => {
    stubProfileFetch({
      list: [
        profile({ name: 'writer', model: 'm' }),
        profile({ name: 'coder', model: 'm' }),
      ],
    })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.agents).toHaveLength(2))

    act(() => result.current.setSelectedAgent('coder'))
    expect(result.current.selectedAgentId).toBe('coder')
    expect(result.current.selectedAgent?.id).toBe('coder')

    // Unknown id resolves to null without throwing.
    act(() => result.current.setSelectedAgent('ghost'))
    expect(result.current.selectedAgent).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

describe('useOperations — saveSettings', () => {
  it('updates state, persists to localStorage, and toasts', () => {
    stubProfileFetch({ list: [] })
    const { result } = renderOperations()

    act(() =>
      result.current.saveSettings({
        defaultModel: 'x-model',
        autoApprove: true,
        activityFeedLength: 7,
      }),
    )

    expect(result.current.settings.activityFeedLength).toBe(7)
    expect(result.current.settings.autoApprove).toBe(true)
    const stored = JSON.parse(
      window.localStorage.getItem('operations-settings') ?? '{}',
    ) as { defaultModel?: string }
    expect(stored.defaultModel).toBe('x-model')
    expect(toastMock).toHaveBeenCalledWith('Operations settings saved', {
      type: 'success',
    })
  })
})

// ---------------------------------------------------------------------------
// saveAgentMeta (localStorage emoji/color preferences)
// ---------------------------------------------------------------------------

describe('useOperations — saveAgentMeta', () => {
  it('persists partial meta and reflects it in the derived agent', async () => {
    stubProfileFetch({ list: [profile({ name: 'writer', model: 'm' })] })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.agents).toHaveLength(1))

    act(() => result.current.saveAgentMeta('writer', { emoji: '\u{1F680}' }))

    await waitFor(() =>
      expect(result.current.agents.at(0)?.meta.emoji).toBe('\u{1F680}'),
    )
    const raw = window.localStorage.getItem('operations:agents:writer')
    expect(raw).not.toBeNull()
    const stored = JSON.parse(raw ?? '{}') as { emoji?: string }
    expect(stored.emoji).toBe('\u{1F680}')
  })
})

// ---------------------------------------------------------------------------
// createAgent mutation
// ---------------------------------------------------------------------------

describe('useOperations — createAgent', () => {
  it('creates a profile, persists meta, selects it, and toasts success', async () => {
    stubProfileFetch({ list: [] })
    const { result } = renderOperations()

    await act(async () => {
      await result.current.createAgent({
        name: 'New Bot',
        model: 'anthropic/claude-opus-4-6',
        emoji: '\u{1F916}',
        systemPrompt: 'be helpful',
        description: 'a helper',
      })
    })

    // normalized id is slugified from the name
    expect(result.current.selectedAgentId).toBe('new-bot')

    const createCall = fetchCalls.find((c) => c.url.includes('/create'))
    expect(createCall).toBeDefined()
    const createBody = readBody(createCall)
    expect(createBody.name).toBe('new-bot')
    expect(createBody.model).toBe('anthropic/claude-opus-4-6')

    // system prompt + description flow through to an update call
    const updateCall = fetchCalls.find((c) => c.url.includes('/update'))
    expect(updateCall).toBeDefined()

    // meta persisted to localStorage
    const stored = JSON.parse(
      window.localStorage.getItem('operations:agents:new-bot') ?? '{}',
    ) as { emoji?: string; systemPrompt?: string }
    expect(stored.emoji).toBe('\u{1F916}')
    expect(stored.systemPrompt).toBe('be helpful')

    expect(toastMock).toHaveBeenCalledWith('Agent created', { type: 'success' })
  })

  it('rejects a blank name and toasts the error', async () => {
    stubProfileFetch({ list: [] })
    const { result } = renderOperations()

    await act(async () => {
      await expect(
        result.current.createAgent({
          name: '   ',
          model: 'm',
          emoji: '',
          systemPrompt: '',
        }),
      ).rejects.toThrow('Agent name is required')
    })
    expect(toastMock).toHaveBeenCalledWith('Agent name is required', {
      type: 'error',
    })
    expect(fetchCalls.some((c) => c.url.includes('/create'))).toBe(false)
  })

  it('rejects the reserved "default" name', async () => {
    stubProfileFetch({ list: [] })
    const { result } = renderOperations()

    await act(async () => {
      await expect(
        result.current.createAgent({
          name: 'Default',
          model: 'm',
          emoji: '',
          systemPrompt: '',
        }),
      ).rejects.toThrow('reserved')
    })
    expect(fetchCalls.some((c) => c.url.includes('/create'))).toBe(false)
  })

  it('rejects a duplicate agent id', async () => {
    stubProfileFetch({ list: [profile({ name: 'writer', model: 'm' })] })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.agents).toHaveLength(1))

    await act(async () => {
      await expect(
        result.current.createAgent({
          name: 'Writer',
          model: 'm',
          emoji: '',
          systemPrompt: '',
        }),
      ).rejects.toThrow('already exists')
    })
  })

  it('surfaces a server-side create failure as a toast + rejection', async () => {
    stubProfileFetch({
      list: [],
      create: jsonResponse({ error: 'disk full' }, { ok: false, status: 500 }),
    })
    const { result } = renderOperations()

    await act(async () => {
      await expect(
        result.current.createAgent({
          name: 'fragile',
          model: 'm',
          emoji: '',
          systemPrompt: '',
        }),
      ).rejects.toThrow('disk full')
    })
    expect(toastMock).toHaveBeenCalledWith('disk full', { type: 'error' })
  })
})

// ---------------------------------------------------------------------------
// saveAgent mutation
// ---------------------------------------------------------------------------

describe('useOperations — saveAgent', () => {
  it('patches model + system prompt and persists emoji to meta', async () => {
    stubProfileFetch({ list: [profile({ name: 'writer', model: 'old' })] })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.agents).toHaveLength(1))

    await act(async () => {
      await result.current.saveAgent({
        agentId: 'writer',
        name: 'Writer',
        model: 'anthropic/claude-opus-4-6',
        emoji: '✍️',
        systemPrompt: 'write well',
      })
    })

    const updateCall = fetchCalls.find((c) => c.url.includes('/update'))
    expect(updateCall).toBeDefined()
    const updateBody = readBody(updateCall)
    expect(updateBody.name).toBe('writer')
    expect(updateBody.patch).toEqual({
      model: 'anthropic/claude-opus-4-6',
      system_prompt: 'write well',
    })

    const stored = JSON.parse(
      window.localStorage.getItem('operations:agents:writer') ?? '{}',
    ) as { emoji?: string; systemPrompt?: string }
    expect(stored.emoji).toBe('✍️')
    expect(stored.systemPrompt).toBe('write well')

    expect(toastMock).toHaveBeenCalledWith('Agent settings saved', {
      type: 'success',
    })
  })

  it('skips the update call entirely when nothing meaningful changed', async () => {
    stubProfileFetch({ list: [profile({ name: 'writer', model: 'm' })] })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.agents).toHaveLength(1))

    await act(async () => {
      await result.current.saveAgent({
        agentId: 'writer',
        name: 'Writer',
        model: '   ',
        emoji: '',
        systemPrompt: '   ',
      })
    })

    expect(fetchCalls.some((c) => c.url.includes('/update'))).toBe(false)
    expect(toastMock).toHaveBeenCalledWith('Agent settings saved', {
      type: 'success',
    })
  })
})

// ---------------------------------------------------------------------------
// deleteAgent mutation
// ---------------------------------------------------------------------------

describe('useOperations — deleteAgent', () => {
  it('deletes the profile, clears its meta, and deselects it', async () => {
    window.localStorage.setItem(
      'operations:agents:writer',
      JSON.stringify({ emoji: '\u{1F916}' }),
    )
    stubProfileFetch({ list: [profile({ name: 'writer', model: 'm' })] })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.agents).toHaveLength(1))
    act(() => result.current.setSelectedAgent('writer'))
    expect(result.current.selectedAgentId).toBe('writer')

    await act(async () => {
      await result.current.deleteAgent('writer')
    })

    const deleteCall = fetchCalls.find((c) => c.url.includes('/delete'))
    expect(deleteCall).toBeDefined()
    expect(readBody(deleteCall).name).toBe('writer')

    expect(window.localStorage.getItem('operations:agents:writer')).toBeNull()
    expect(result.current.selectedAgentId).toBeNull()
    expect(toastMock).toHaveBeenCalledWith('Agent deleted', { type: 'success' })
  })

  it('refuses to delete the default profile', async () => {
    stubProfileFetch({ list: [profile({ name: 'default', model: 'm' })] })
    const { result } = renderOperations()

    await act(async () => {
      await expect(result.current.deleteAgent('default')).rejects.toThrow(
        'Cannot delete the default profile',
      )
    })
    expect(fetchCalls.some((c) => c.url.includes('/delete'))).toBe(false)
    expect(toastMock).toHaveBeenCalledWith(
      'Cannot delete the default profile',
      { type: 'error' },
    )
  })
})

// ---------------------------------------------------------------------------
// Query error handling
// ---------------------------------------------------------------------------

describe('useOperations — query errors', () => {
  it('surfaces a non-JSON profiles response as a config query error', async () => {
    const htmlResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('<html></html>'),
    } as unknown as Response
    stubProfileFetch({ listResponse: htmlResponse })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.configQuery.isError).toBe(true))
    expect(result.current.agents).toEqual([])
  })

  it('keeps agents empty when sessions/cron fail but config succeeds', async () => {
    fetchSessionsMock.mockRejectedValue(new Error('gateway down'))
    fetchCronJobsMock.mockRejectedValue(new Error('cron down'))
    stubProfileFetch({ list: [profile({ name: 'writer', model: 'm' })] })
    const { result } = renderOperations()

    await waitFor(() => expect(result.current.agents).toHaveLength(1))
    const agent = result.current.agents.at(0)
    // Derivation degrades gracefully to empty session/job lists.
    expect(agent?.sessions).toEqual([])
    expect(agent?.jobs).toEqual([])
    expect(agent?.status).toBe('idle')
  })
})
