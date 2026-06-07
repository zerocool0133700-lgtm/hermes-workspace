import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COLUMN_LABELS,
  COLUMN_ORDER,
  createTask,
  deleteTask,
  fetchAssignees,
  fetchTasks,
  getActiveBackend,
  isOverdue,
  launchSession,
  linkSession,
  moveTask,
  resetBackendResolution,
  updateTask,
} from './tasks-api'
import type { ClaudeTask, TaskColumn } from './tasks-api'

// --- Helpers -------------------------------------------------------------

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html' },
  })
}

function stubFetch(impl: typeof fetch): FetchMock {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

/**
 * A request is a backend probe iff it carries the AbortSignal timeout that
 * probeBackend() attaches. The real API functions never pass a signal, so this
 * cleanly separates probe traffic from the call under test even when the URLs
 * collide (e.g. a paramless fetchTasks() GET to the same base).
 */
function isProbe(init: RequestInit | undefined): boolean {
  return init?.signal instanceof AbortSignal
}

/**
 * Make the backend resolver settle on the given backend by controlling the two
 * probe responses. The resolver prefers hermes only when it has data
 * (tasks.length > 0) and at least as much as claude; otherwise claude wins.
 */
function stubResolvedTo(
  backend: 'hermes' | 'claude',
  handler: typeof fetch,
): FetchMock {
  return stubFetch((input, init) => {
    const url = String(input)
    if (isProbe(init) && url === '/api/hermes-tasks') {
      return Promise.resolve(
        backend === 'hermes'
          ? jsonResponse({ tasks: [{ id: 'probe' }] })
          : jsonResponse({ tasks: [] }),
      )
    }
    if (isProbe(init) && url === '/api/claude-tasks') {
      // Claude probe is always empty so it never out-votes a populated hermes
      // probe, and is the default backend when hermes is empty.
      return Promise.resolve(jsonResponse({ tasks: [] }))
    }
    return handler(input, init)
  })
}

const sampleTask: ClaudeTask = {
  id: 'task-1',
  title: 'Example',
  description: 'Example description',
  column: 'todo',
  priority: 'high',
  assignee: null,
  tags: [],
  due_date: null,
  position: 0,
  created_by: 'user',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  resetBackendResolution()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// --- Backend resolution --------------------------------------------------

describe('backend resolution', () => {
  it('returns null active backend before any probe', () => {
    expect(getActiveBackend()).toBeNull()
  })

  it('selects hermes when its probe has data and exposes it via getActiveBackend', async () => {
    const mock = stubFetch((input, init) => {
      const url = String(input)
      if (isProbe(init) && url === '/api/hermes-tasks') {
        return Promise.resolve(jsonResponse({ tasks: [{ id: 'a' }] }))
      }
      if (isProbe(init) && url === '/api/claude-tasks') {
        return Promise.resolve(jsonResponse({ tasks: [] }))
      }
      // Real fetchTasks GET to the resolved (hermes) backend.
      return Promise.resolve(jsonResponse({ tasks: [sampleTask] }))
    })

    await fetchTasks()

    expect(getActiveBackend()).toBe('hermes')
    // Both backends are probed.
    const probeUrls = mock.mock.calls
      .filter(([, init]) => isProbe(init))
      .map(([input]) => String(input))
    expect(probeUrls).toContain('/api/hermes-tasks')
    expect(probeUrls).toContain('/api/claude-tasks')
  })

  it('defaults to claude when both probes are empty', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ tasks: [] })))

    await fetchTasks()

    expect(getActiveBackend()).toBe('claude')
  })

  it('treats a non-JSON (HTML catch-all) hermes probe as missing and falls back to claude', async () => {
    stubFetch((input, init) => {
      const url = String(input)
      if (isProbe(init) && url === '/api/hermes-tasks') {
        return Promise.resolve(htmlResponse('<!doctype html><html></html>'))
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    await fetchTasks()

    expect(getActiveBackend()).toBe('claude')
  })

  it('caches the resolution so probing only happens once across calls', async () => {
    const mock = stubResolvedTo('claude', () =>
      Promise.resolve(jsonResponse({ tasks: [sampleTask] })),
    )

    await fetchTasks()
    await fetchTasks()

    const probeCount = mock.mock.calls.filter(([, init]) =>
      isProbe(init),
    ).length
    // Two probes total (one per backend), not four.
    expect(probeCount).toBe(2)
  })

  it('re-probes after resetBackendResolution', async () => {
    const mock = stubResolvedTo('claude', () =>
      Promise.resolve(jsonResponse({ tasks: [] })),
    )

    await fetchTasks()
    resetBackendResolution()
    await fetchTasks()

    const probeCount = mock.mock.calls.filter(([, init]) =>
      isProbe(init),
    ).length
    expect(probeCount).toBe(4)
  })
})

// --- fetchTasks ----------------------------------------------------------

describe('fetchTasks', () => {
  it('returns the tasks array on success and builds the query string from params', async () => {
    const mock = stubResolvedTo('claude', () =>
      Promise.resolve(jsonResponse({ tasks: [sampleTask] })),
    )

    const tasks = await fetchTasks({
      column: 'in_progress',
      assignee: 'bot',
      priority: 'low',
      include_done: true,
    })

    expect(tasks).toEqual([sampleTask])
    const requestedUrl = String(
      mock.mock.calls.map(([input]) => String(input)).at(-1),
    )
    expect(requestedUrl.startsWith('/api/claude-tasks?')).toBe(true)
    expect(requestedUrl).toContain('column=in_progress')
    expect(requestedUrl).toContain('assignee=bot')
    expect(requestedUrl).toContain('priority=low')
    expect(requestedUrl).toContain('include_done=true')
  })

  it('throws with the status code on a non-OK response', async () => {
    stubResolvedTo('claude', () =>
      Promise.resolve(jsonResponse({ tasks: [] }, 500)),
    )

    await expect(fetchTasks()).rejects.toThrow('Failed to fetch tasks: 500')
  })

  it('defensively returns an empty array when the payload lacks a tasks field', async () => {
    stubResolvedTo('claude', () =>
      Promise.resolve(jsonResponse({ unexpected: 'shape' })),
    )

    await expect(fetchTasks()).resolves.toEqual([])
  })

  it('rejects when the network request is aborted/fails', async () => {
    // Probes resolve (claude wins); the real fetchTasks GET rejects.
    stubResolvedTo('claude', () =>
      Promise.reject(new DOMException('Aborted', 'AbortError')),
    )

    await expect(fetchTasks()).rejects.toThrow('Aborted')
  })
})

// --- fetchAssignees ------------------------------------------------------

describe('fetchAssignees', () => {
  it('returns the assignees payload from the resolved backend', async () => {
    stubResolvedTo('claude', (input) => {
      if (String(input) === '/api/claude-tasks-assignees') {
        return Promise.resolve(
          jsonResponse({
            assignees: [{ id: 'me', label: 'Me', isHuman: true }],
            humanReviewer: 'me',
          }),
        )
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    await expect(fetchAssignees()).resolves.toEqual({
      assignees: [{ id: 'me', label: 'Me', isHuman: true }],
      humanReviewer: 'me',
    })
  })

  it('falls back to empty assignees on a non-OK response (no throw)', async () => {
    stubResolvedTo('claude', (input) => {
      if (String(input) === '/api/claude-tasks-assignees') {
        return Promise.resolve(jsonResponse({ assignees: [] }, 503))
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    await expect(fetchAssignees()).resolves.toEqual({
      assignees: [],
      humanReviewer: null,
    })
  })
})

// --- createTask ----------------------------------------------------------

describe('createTask', () => {
  it('POSTs the input as JSON and returns the created task', async () => {
    const mock = stubResolvedTo('claude', (input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ task: sampleTask }))
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    const result = await createTask({ title: 'New task', priority: 'high' })

    expect(result).toEqual(sampleTask)
    const postCall = mock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(postCall).toBeDefined()
    if (!postCall) throw new Error('expected a POST call')
    const [url, init] = postCall
    expect(String(url)).toBe('/api/claude-tasks')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init?.body).toBe(
      JSON.stringify({ title: 'New task', priority: 'high' }),
    )
  })

  it('surfaces the detail message from an error body', async () => {
    stubResolvedTo('claude', (input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({ detail: 'title is required' }, 422),
        )
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    await expect(createTask({ title: '' })).rejects.toThrow('title is required')
  })

  it('falls back to the status message when the error body is not valid JSON', async () => {
    stubResolvedTo('claude', (input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(htmlResponse('Internal Server Error', 500))
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    await expect(createTask({ title: 'x' })).rejects.toThrow(
      'Failed to create task: 500',
    )
  })
})

// --- updateTask / deleteTask / linkSession -------------------------------

describe('updateTask', () => {
  it('PATCHes the task by id with the partial input and returns the task', async () => {
    const mock = stubResolvedTo('claude', (input, init) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ task: sampleTask }))
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    const result = await updateTask('task-1', { title: 'Renamed' })

    expect(result).toEqual(sampleTask)
    const patchCall = mock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH',
    )
    if (!patchCall) throw new Error('expected a PATCH call')
    const [url, init] = patchCall
    expect(String(url)).toBe('/api/claude-tasks/task-1')
    expect(init?.body).toBe(JSON.stringify({ title: 'Renamed' }))
  })

  it('throws on a non-OK update', async () => {
    stubResolvedTo('claude', (input, init) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({}, 404))
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    await expect(updateTask('missing', { title: 'x' })).rejects.toThrow(
      'Failed to update task: 404',
    )
  })
})

describe('deleteTask', () => {
  it('sends a DELETE to the task url and resolves to void', async () => {
    const mock = stubResolvedTo('claude', (input, init) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    await expect(deleteTask('task-1')).resolves.toBeUndefined()
    const deleteCall = mock.mock.calls.find(
      ([, init]) => init?.method === 'DELETE',
    )
    if (!deleteCall) throw new Error('expected a DELETE call')
    expect(String(deleteCall[0])).toBe('/api/claude-tasks/task-1')
  })

  it('throws on a failed delete', async () => {
    stubResolvedTo('claude', (input, init) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 500 }))
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    await expect(deleteTask('task-1')).rejects.toThrow(
      'Failed to delete task: 500',
    )
  })
})

describe('linkSession', () => {
  it('PATCHes the session_id (including null to unlink) and returns the task', async () => {
    const mock = stubResolvedTo('claude', (input, init) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ task: sampleTask }))
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    await linkSession('task-1', null)

    const patchCall = mock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH',
    )
    if (!patchCall) throw new Error('expected a PATCH call')
    expect(String(patchCall[0])).toBe('/api/claude-tasks/task-1')
    expect(patchCall[1]?.body).toBe(JSON.stringify({ session_id: null }))
  })
})

// --- launchSession -------------------------------------------------------

describe('launchSession', () => {
  it('POSTs to the launch action url and returns the raw launch payload', async () => {
    const launchPayload = {
      sessionId: 'sess-9',
      briefing: 'Do the thing',
      task: sampleTask,
    }
    const mock = stubResolvedTo('claude', (input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse(launchPayload))
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    const result = await launchSession('task-1')

    expect(result).toEqual(launchPayload)
    const postCall = mock.mock.calls.find(([, init]) => init?.method === 'POST')
    if (!postCall) throw new Error('expected a POST call')
    expect(String(postCall[0])).toBe('/api/claude-tasks/task-1?action=launch')
    expect(postCall[1]?.body).toBe(JSON.stringify({}))
  })

  it('throws on a failed launch', async () => {
    stubResolvedTo('claude', (input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse({}, 409))
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    await expect(launchSession('task-1')).rejects.toThrow(
      'Failed to launch session: 409',
    )
  })
})

// --- moveTask ------------------------------------------------------------

describe('moveTask', () => {
  it('POSTs to the move action with column and moved_by, defaulting moved_by to "user"', async () => {
    const mock = stubResolvedTo('claude', (input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ task: sampleTask }))
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    const result = await moveTask('task-1', 'done')

    expect(result).toEqual(sampleTask)
    const postCall = mock.mock.calls.find(([, init]) => init?.method === 'POST')
    if (!postCall) throw new Error('expected a POST call')
    expect(String(postCall[0])).toBe('/api/claude-tasks/task-1?action=move')
    expect(postCall[1]?.body).toBe(
      JSON.stringify({ column: 'done', moved_by: 'user' }),
    )
  })

  it('surfaces the detail message on a non-OK move', async () => {
    stubResolvedTo('claude', (input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({ detail: 'column transition not allowed' }, 400),
        )
      }
      return Promise.resolve(jsonResponse({ tasks: [] }))
    })

    await expect(moveTask('task-1', 'review')).rejects.toThrow(
      'column transition not allowed',
    )
  })
})

// --- Pure helpers / constants --------------------------------------------

describe('isOverdue', () => {
  it('returns false when there is no due date', () => {
    expect(isOverdue({ ...sampleTask, due_date: null })).toBe(false)
  })

  it('returns true for a date strictly before today (local midnight)', () => {
    expect(isOverdue({ ...sampleTask, due_date: '2000-01-01' })).toBe(true)
  })

  it('returns false for today and future dates', () => {
    const future = '2999-12-31'
    expect(isOverdue({ ...sampleTask, due_date: future })).toBe(false)

    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      '0',
    )}-${String(now.getDate()).padStart(2, '0')}`
    expect(isOverdue({ ...sampleTask, due_date: today })).toBe(false)
  })
})

describe('display constants', () => {
  it('exposes a label for every ordered column', () => {
    for (const column of COLUMN_ORDER) {
      expect(typeof COLUMN_LABELS[column]).toBe('string')
    }
    // 'deleted' has a label but is intentionally excluded from the ordered board.
    const deleted: TaskColumn = 'deleted'
    expect(COLUMN_ORDER).not.toContain(deleted)
    expect(COLUMN_LABELS[deleted]).toBe('Deleted')
  })
})
