import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  extractCheckpoints,
  extractSingleCheckpoint,
  firstPendingCheckpoint,
  formatCheckpointStatus,
  formatCheckpointTimestamp,
  getCheckpointActionButtonClass,
  getCheckpointCommitHashLabel,
  getCheckpointDiffStat,
  getCheckpointDiffStatParsed,
  getCheckpointFullSummary,
  getCheckpointReviewSubmitLabel,
  getCheckpointReviewSuccessMessage,
  getCheckpointStatusBadgeClass,
  getCheckpointSummary,
  getWorkspaceCheckpointDetail,
  getWorkspaceCheckpointDiff,
  isCheckpointReviewable,
  listWorkspaceCheckpoints,
  matchesCheckpointProject,
  parseUtcTimestamp,
  readWorkspacePayload,
  runCheckpointTypecheck,
  runWorkspaceCheckpointTsc,
  sortCheckpointsNewestFirst,
  submitCheckpointReview,
  workspaceRequestJson,
} from './workspace-checkpoints'
import type { WorkspaceCheckpoint } from './workspace-checkpoints'

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

/** Read the JSON body that was passed to a mocked fetch call. */
function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  if (!init || typeof init.body !== 'string') return {}
  const parsed: unknown = JSON.parse(init.body)
  if (parsed !== null && typeof parsed === 'object') {
    return parsed as Record<string, unknown>
  }
  return {}
}

function checkpoint(
  overrides: Partial<WorkspaceCheckpoint> = {},
): WorkspaceCheckpoint {
  return {
    id: 'cp-1',
    task_run_id: 'run-1',
    summary: null,
    diff_stat: null,
    verification_raw: null,
    status: 'pending',
    reviewer_notes: null,
    commit_hash: null,
    created_at: '2026-03-10T21:40:00Z',
    task_name: null,
    mission_name: null,
    project_name: null,
    agent_name: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('readWorkspacePayload', () => {
  it('returns null for an empty body', async () => {
    const result = await readWorkspacePayload(new Response(''))
    expect(result).toBeNull()
  })

  it('parses JSON when the body is valid JSON', async () => {
    const result = await readWorkspacePayload(new Response('{"a":1}'))
    expect(result).toEqual({ a: 1 })
  })

  it('returns the raw text when the body is not JSON', async () => {
    const result = await readWorkspacePayload(new Response('not json'))
    expect(result).toBe('not json')
  })
})

describe('workspaceRequestJson', () => {
  it('returns the parsed payload on a 2xx response', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ hello: 'world' }))

    const result = await workspaceRequestJson('/api/x')

    expect(result).toEqual({ hello: 'world' })
    expect(fetchMock).toHaveBeenCalledWith('/api/x', undefined)
  })

  it('passes the init through to fetch', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    await workspaceRequestJson('/api/y', { method: 'POST', body: '{}' })

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.method).toBe('POST')
  })

  it('surfaces the error field from a non-OK JSON body', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ error: 'boom' }, { status: 500 }),
    )

    await expect(workspaceRequestJson('/api/x')).rejects.toThrow('boom')
  })

  it('falls back to the message field when error is absent', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ message: 'nope' }, { status: 400 }),
    )

    await expect(workspaceRequestJson('/api/x')).rejects.toThrow('nope')
  })

  it('falls back to a status-based message when the body has no error or message', async () => {
    getFetchMock().mockResolvedValue(jsonResponse({}, { status: 503 }))

    await expect(workspaceRequestJson('/api/x')).rejects.toThrow(
      'Request failed with status 503',
    )
  })

  it('falls back to a status message when the error body is non-JSON text', async () => {
    getFetchMock().mockResolvedValue(
      new Response('gateway error', { status: 502 }),
    )

    await expect(workspaceRequestJson('/api/x')).rejects.toThrow(
      'Request failed with status 502',
    )
  })

  it('falls back to a status message when error fields are blank strings', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ error: '   ', message: '' }, { status: 418 }),
    )

    await expect(workspaceRequestJson('/api/x')).rejects.toThrow(
      'Request failed with status 418',
    )
  })

  it('propagates network errors from fetch', async () => {
    getFetchMock().mockRejectedValue(new Error('offline'))

    await expect(workspaceRequestJson('/api/x')).rejects.toThrow('offline')
  })

  it('propagates abort errors from fetch', async () => {
    getFetchMock().mockRejectedValue(
      new DOMException('The operation was aborted.', 'AbortError'),
    )

    await expect(workspaceRequestJson('/api/x')).rejects.toThrow(
      'The operation was aborted.',
    )
  })
})

describe('extractCheckpoints', () => {
  it('normalizes a top-level array', () => {
    const result = extractCheckpoints([{ id: 'a', status: 'approved' }])
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('a')
    expect(result[0]?.status).toBe('approved')
  })

  it('reads the checkpoints wrapper', () => {
    const result = extractCheckpoints({ checkpoints: [{ id: 'a' }] })
    expect(result).toHaveLength(1)
  })

  it('reads the data wrapper', () => {
    const result = extractCheckpoints({ data: [{ id: 'b' }] })
    expect(result[0]?.id).toBe('b')
  })

  it('reads the items wrapper', () => {
    const result = extractCheckpoints({ items: [{ id: 'c' }] })
    expect(result[0]?.id).toBe('c')
  })

  it('returns an empty array for unrecognized shapes', () => {
    expect(extractCheckpoints({ nope: true })).toEqual([])
    expect(extractCheckpoints(null)).toEqual([])
    expect(extractCheckpoints('string')).toEqual([])
  })

  it('applies defaults for missing checkpoint fields', () => {
    const result = extractCheckpoints([{}])
    const cp = result[0]
    expect(cp).toBeDefined()
    expect(cp?.task_run_id).toBe('unknown-run')
    expect(cp?.status).toBe('pending')
    expect(cp?.summary).toBeNull()
    expect(typeof cp?.id).toBe('string')
    expect(cp?.id.length).toBeGreaterThan(0)
    expect(typeof cp?.created_at).toBe('string')
  })

  it('maps the verification string into verification_raw', () => {
    const result = extractCheckpoints([{ verification: 'all green' }])
    expect(result[0]?.verification_raw).toBe('all green')
  })

  it('keeps nullable string fields null when the wrong type is supplied', () => {
    const result = extractCheckpoints([
      { summary: 123, diff_stat: false, reviewer_notes: {}, commit_hash: [] },
    ])
    const cp = result[0]
    expect(cp?.summary).toBeNull()
    expect(cp?.diff_stat).toBeNull()
    expect(cp?.reviewer_notes).toBeNull()
    expect(cp?.commit_hash).toBeNull()
  })
})

describe('extractSingleCheckpoint', () => {
  it('returns the first checkpoint from a wrapped array', () => {
    const cp = extractSingleCheckpoint({ checkpoints: [{ id: 'first' }] })
    expect(cp?.id).toBe('first')
  })

  it('normalizes a bare object as a single checkpoint', () => {
    const cp = extractSingleCheckpoint({ id: 'solo', status: 'approved' })
    expect(cp?.id).toBe('solo')
    expect(cp?.status).toBe('approved')
  })

  it('returns null when the payload is not an object', () => {
    expect(extractSingleCheckpoint(null)).toBeNull()
    expect(extractSingleCheckpoint('text')).toBeNull()
    expect(extractSingleCheckpoint(42)).toBeNull()
  })

  it('returns null for an empty array', () => {
    expect(extractSingleCheckpoint([])).toBeNull()
  })
})

describe('listWorkspaceCheckpoints', () => {
  it('requests the base endpoint with no query for no status', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ checkpoints: [{ id: 'a' }] }))

    const result = await listWorkspaceCheckpoints()

    expect(result).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/checkpoints',
      undefined,
    )
  })

  it('adds a status query when a concrete status is given', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse([]))

    await listWorkspaceCheckpoints('approved')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/checkpoints?status=approved',
      undefined,
    )
  })

  it('omits the status query for the "all" sentinel', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse([]))

    await listWorkspaceCheckpoints('all')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/checkpoints',
      undefined,
    )
  })

  it('surfaces a non-OK error', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ error: 'denied' }, { status: 403 }),
    )

    await expect(listWorkspaceCheckpoints()).rejects.toThrow('denied')
  })
})

describe('submitCheckpointReview', () => {
  it('posts to the action endpoint and returns the review result', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({
        checkpoint: { id: 'cp-1', status: 'approved', commit_hash: 'abc1234' },
        status: 'approved',
        commit_hash: 'abc1234',
        target_branch: 'main',
        pr_url: 'https://example.com/pr/1',
      }),
    )

    const result = await submitCheckpointReview('cp-1', 'approve-and-commit')

    expect(result.checkpoint.id).toBe('cp-1')
    expect(result.status).toBe('approved')
    expect(result.commit_hash).toBe('abc1234')
    expect(result.target_branch).toBe('main')
    expect(result.pr_url).toBe('https://example.com/pr/1')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/workspace/checkpoints/cp-1/approve-and-commit')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('encodes the checkpoint id in the URL', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ checkpoint: { id: 'a/b' } }))

    await submitCheckpointReview('a/b', 'approve')

    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toBe('/api/workspace/checkpoints/a%2Fb/approve')
  })

  it('trims reviewer notes into the request body', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ checkpoint: { id: 'cp-1' } }))

    await submitCheckpointReview('cp-1', 'revise', '  please fix  ')

    expect(bodyOf(fetchMock.mock.calls[0]?.[1])).toEqual({
      reviewer_notes: 'please fix',
    })
  })

  it('omits reviewer notes from the body when blank', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ checkpoint: { id: 'cp-1' } }))

    await submitCheckpointReview('cp-1', 'reject', '   ')

    expect(bodyOf(fetchMock.mock.calls[0]?.[1])).toEqual({})
  })

  it('omits reviewer notes when none are passed', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ checkpoint: { id: 'cp-1' } }))

    await submitCheckpointReview('cp-1', 'approve')

    expect(bodyOf(fetchMock.mock.calls[0]?.[1])).toEqual({})
  })

  it('falls back to the checkpoint values when the envelope omits them', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({
        checkpoint: { id: 'cp-1', status: 'revised', commit_hash: 'def5678' },
      }),
    )

    const result = await submitCheckpointReview('cp-1', 'revise')

    expect(result.status).toBe('revised')
    expect(result.commit_hash).toBe('def5678')
    expect(result.target_branch).toBeNull()
    expect(result.pr_url).toBeNull()
  })

  it('normalizes a bare checkpoint payload without a wrapper', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ id: 'cp-9', status: 'approved' }),
    )

    const result = await submitCheckpointReview('cp-9', 'approve')

    expect(result.checkpoint.id).toBe('cp-9')
    expect(result.status).toBe('approved')
  })

  it('throws when the checkpoint cannot be resolved from the payload', async () => {
    getFetchMock().mockResolvedValue(jsonResponse('plain string'))

    await expect(submitCheckpointReview('cp-1', 'approve')).rejects.toThrow(
      'Checkpoint response was empty',
    )
  })

  it('surfaces the server error on a non-OK status', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ error: 'conflict' }, { status: 409 }),
    )

    await expect(submitCheckpointReview('cp-1', 'approve')).rejects.toThrow(
      'conflict',
    )
  })
})

describe('getWorkspaceCheckpointDetail', () => {
  it('requests the detail endpoint and maps nested checkpoint detail fields', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({
        checkpoint: {
          id: 'cp-1',
          status: 'pending',
          task_id: 'task-1',
          project_id: 'proj-1',
          project_path: '/work',
          agent_model: 'gpt-5',
          agent_adapter_type: 'codex',
          task_run_status: 'completed',
          task_run_attempt: 2,
          task_run_workspace_path: '/ws',
          task_run_started_at: '2026-03-10T21:00:00Z',
          task_run_completed_at: '2026-03-10T21:40:00Z',
          task_run_error: null,
          task_run_input_tokens: 1000,
          task_run_output_tokens: 500,
          task_run_cost_cents: 12,
        },
        parsed_diff_stat: { raw: 'src/a.ts | 3 ++-' },
        verification: {
          tsc: { status: 'passed', label: 'OK', checked_at: '2026-03-10' },
        },
        file_diffs: [{ path: 'src/a.ts', diff: '@@ -1 +1 @@' }],
        run_events: [{ id: 1, type: 'log', text: 'started' }],
      }),
    )

    const result = await getWorkspaceCheckpointDetail('cp-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/checkpoints/cp-1',
      undefined,
    )
    expect(result.id).toBe('cp-1')
    expect(result.task_id).toBe('task-1')
    expect(result.project_id).toBe('proj-1')
    expect(result.agent_model).toBe('gpt-5')
    expect(result.task_run_attempt).toBe(2)
    expect(result.task_run_input_tokens).toBe(1000)
    expect(result.task_run_output_tokens).toBe(500)
    expect(result.task_run_cost_cents).toBe(12)
    expect(result.verification.tsc.status).toBe('passed')
    // Unsupplied keys are normalized from undefined → 'missing' (the default
    // map is overwritten by the explicit per-key normalizeVerificationItem).
    expect(result.verification.tests.status).toBe('missing')
    expect(result.run_events).toHaveLength(1)
    expect(result.run_events[0]?.text).toBe('started')
    expect(result.diff_files).toHaveLength(1)
    expect(result.diff_files[0]?.path).toBe('src/a.ts')
    expect(result.diff_files[0]?.patch).toBe('@@ -1 +1 @@')
    // "3 ++-" → 2 additions, 1 deletion parsed out of the diff stat line.
    expect(result.diff_files[0]?.additions).toBe(2)
    expect(result.diff_files[0]?.deletions).toBe(1)
  })

  it('handles a flat (non-wrapped) detail record and diff_files fallback', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({
        id: 'cp-2',
        status: 'approved',
        diff_files: [{ path: 'b.ts', patch: 'patch-text' }],
        run_events: [{ id: 2, type: 'status', text: 'done' }],
        verification: { lint: { status: 'failed', label: 'Lint failed' } },
      }),
    )

    const result = await getWorkspaceCheckpointDetail('cp-2')

    expect(result.id).toBe('cp-2')
    expect(result.diff_files[0]?.path).toBe('b.ts')
    expect(result.diff_files[0]?.patch).toBe('patch-text')
    expect(result.diff_files[0]?.additions).toBeNull()
    expect(result.diff_files[0]?.deletions).toBeNull()
    expect(result.run_events[0]?.text).toBe('done')
    expect(result.verification.lint.status).toBe('failed')
  })

  it('defaults missing detail fields and uses an empty verification map', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ checkpoint: { id: 'cp-3' } }),
    )

    const result = await getWorkspaceCheckpointDetail('cp-3')

    expect(result.task_id).toBeNull()
    expect(result.task_run_attempt).toBeNull()
    expect(result.task_run_cost_cents).toBeNull()
    expect(result.diff_files).toEqual([])
    expect(result.run_events).toEqual([])
    expect(result.verification.tsc.status).toBe('missing')
    expect(result.verification.tests.status).toBe('missing')
    expect(result.verification.lint.status).toBe('missing')
    expect(result.verification.e2e.status).toBe('missing')
  })

  it('falls back to "unknown" for diff files missing a path', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ checkpoint: { id: 'cp-4' }, file_diffs: [{ diff: 'd' }] }),
    )

    const result = await getWorkspaceCheckpointDetail('cp-4')

    expect(result.diff_files[0]?.path).toBe('unknown')
    expect(result.diff_files[0]?.patch).toBe('d')
  })

  it('throws when the detail response is empty', async () => {
    getFetchMock().mockResolvedValue(jsonResponse('not an object'))

    await expect(getWorkspaceCheckpointDetail('cp-1')).rejects.toThrow(
      'Checkpoint detail response was empty',
    )
  })

  it('surfaces a non-OK error', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ error: 'not found' }, { status: 404 }),
    )

    await expect(getWorkspaceCheckpointDetail('cp-1')).rejects.toThrow(
      'not found',
    )
  })
})

describe('getWorkspaceCheckpointDiff', () => {
  it('returns the diff string from the endpoint', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ diff: 'raw diff text' }))

    const result = await getWorkspaceCheckpointDiff('cp-1')

    expect(result).toEqual({ diff: 'raw diff text' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/checkpoints/cp-1/diff',
      undefined,
    )
  })

  it('coerces a missing or non-string diff to an empty string', async () => {
    getFetchMock().mockResolvedValue(jsonResponse({ diff: 42 }))

    const result = await getWorkspaceCheckpointDiff('cp-1')

    expect(result.diff).toBe('')
  })

  it('throws when the diff response is not an object', async () => {
    getFetchMock().mockResolvedValue(jsonResponse('text body'))

    await expect(getWorkspaceCheckpointDiff('cp-1')).rejects.toThrow(
      'Checkpoint diff response was empty',
    )
  })

  it('surfaces a non-OK error', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ message: 'diff unavailable' }, { status: 500 }),
    )

    await expect(getWorkspaceCheckpointDiff('cp-1')).rejects.toThrow(
      'diff unavailable',
    )
  })
})

describe('runCheckpointTypecheck', () => {
  it('posts to the verify-tsc endpoint and returns the command result', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        command: 'pnpm tsc',
        cwd: '/work',
        stdout: 'clean',
        stderr: '',
        exitCode: 0,
      }),
    )

    const result = await runCheckpointTypecheck('cp-1')

    expect(result).toEqual({
      ok: true,
      command: 'pnpm tsc',
      cwd: '/work',
      stdout: 'clean',
      stderr: '',
      exitCode: 0,
    })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/workspace/checkpoints/cp-1/verify-tsc')
    expect(init?.method).toBe('POST')
    expect(bodyOf(init)).toEqual({})
  })

  it('applies defaults for missing/wrong-typed fields', async () => {
    getFetchMock().mockResolvedValue(jsonResponse({ exitCode: 'nope' }))

    const result = await runCheckpointTypecheck('cp-1')

    expect(result.ok).toBe(false)
    expect(result.command).toBe('npx tsc --noEmit')
    expect(result.cwd).toBe('')
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeNull()
  })

  it('throws when the verification response is empty', async () => {
    getFetchMock().mockResolvedValue(jsonResponse('text'))

    await expect(runCheckpointTypecheck('cp-1')).rejects.toThrow(
      'Verification response was empty',
    )
  })

  it('surfaces a non-OK error', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ error: 'verify failed' }, { status: 500 }),
    )

    await expect(runCheckpointTypecheck('cp-1')).rejects.toThrow(
      'verify failed',
    )
  })
})

describe('runWorkspaceCheckpointTsc', () => {
  it('returns a normalized verification item on a known status', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'passed',
        label: 'Typecheck passed',
        output: 'ok',
        checked_at: '2026-03-10',
      }),
    )

    const result = await runWorkspaceCheckpointTsc('cp-1')

    expect(result).toEqual({
      status: 'passed',
      label: 'Typecheck passed',
      output: 'ok',
      checked_at: '2026-03-10',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/checkpoints/cp-1/verify-tsc',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('coerces an unknown status to "missing" and applies field defaults', async () => {
    getFetchMock().mockResolvedValue(jsonResponse({ status: 'weird' }))

    const result = await runWorkspaceCheckpointTsc('cp-1')

    expect(result.status).toBe('missing')
    expect(result.label).toBe('Unknown')
    expect(result.output).toBeNull()
    expect(result.checked_at).toBeNull()
  })

  it('throws when the verification response is empty', async () => {
    getFetchMock().mockResolvedValue(jsonResponse(null))

    await expect(runWorkspaceCheckpointTsc('cp-1')).rejects.toThrow(
      'Verification response was empty',
    )
  })

  it('surfaces a non-OK error', async () => {
    getFetchMock().mockResolvedValue(
      jsonResponse({ error: 'tsc blew up' }, { status: 500 }),
    )

    await expect(runWorkspaceCheckpointTsc('cp-1')).rejects.toThrow(
      'tsc blew up',
    )
  })
})

describe('formatCheckpointStatus', () => {
  it('replaces underscores and title-cases the words', () => {
    expect(formatCheckpointStatus('not_configured')).toBe('Not Configured')
    expect(formatCheckpointStatus('approved')).toBe('Approved')
  })
})

describe('getCheckpointStatusBadgeClass', () => {
  it('returns tone-specific classes per status', () => {
    expect(getCheckpointStatusBadgeClass('approved')).toContain('emerald')
    expect(getCheckpointStatusBadgeClass('revised')).toContain('amber')
    expect(getCheckpointStatusBadgeClass('rejected')).toContain('red')
    expect(getCheckpointStatusBadgeClass('pending')).toContain('primary')
  })
})

describe('getCheckpointActionButtonClass', () => {
  it('returns tone-specific classes', () => {
    expect(getCheckpointActionButtonClass('approve')).toContain('emerald')
    expect(getCheckpointActionButtonClass('revise')).toContain('amber')
    expect(getCheckpointActionButtonClass('reject')).toContain('red')
  })
})

describe('parseUtcTimestamp', () => {
  it('appends Z to a space-separated SQLite timestamp', () => {
    const date = parseUtcTimestamp('2026-03-10 21:40:00')
    expect(date.toISOString()).toBe('2026-03-10T21:40:00.000Z')
  })

  it('leaves an ISO timestamp untouched', () => {
    const date = parseUtcTimestamp('2026-03-10T21:40:00Z')
    expect(date.toISOString()).toBe('2026-03-10T21:40:00.000Z')
  })

  it('leaves a Z-suffixed value untouched', () => {
    const date = parseUtcTimestamp('2026-03-10 21:40:00Z')
    expect(Number.isNaN(date.getTime())).toBe(false)
  })
})

describe('formatCheckpointTimestamp', () => {
  it('returns the original value for an unparseable timestamp', () => {
    expect(formatCheckpointTimestamp('garbage')).toBe('garbage')
  })

  it('formats a valid timestamp into a non-empty localized string', () => {
    const out = formatCheckpointTimestamp('2026-03-10T21:40:00Z')
    expect(out).not.toBe('2026-03-10T21:40:00Z')
    expect(out.length).toBeGreaterThan(0)
  })
})

describe('matchesCheckpointProject', () => {
  it('matches everything when no project filter is supplied', () => {
    expect(matchesCheckpointProject(checkpoint(), undefined)).toBe(true)
  })

  it('matches by project name', () => {
    expect(
      matchesCheckpointProject(
        checkpoint({ project_name: 'hermes' }),
        'hermes',
      ),
    ).toBe(true)
    expect(
      matchesCheckpointProject(checkpoint({ project_name: 'hermes' }), 'other'),
    ).toBe(false)
  })
})

describe('getCheckpointSummary', () => {
  it('returns the trimmed summary when present', () => {
    expect(getCheckpointSummary(checkpoint({ summary: '  hi  ' }))).toBe('hi')
  })

  it('returns a placeholder when the summary is empty', () => {
    expect(getCheckpointSummary(checkpoint({ summary: '   ' }))).toBe(
      'No checkpoint summary provided.',
    )
    expect(getCheckpointSummary(checkpoint({ summary: null }))).toBe(
      'No checkpoint summary provided.',
    )
  })

  it('truncates long summaries with an ellipsis', () => {
    const long = 'a'.repeat(250)
    const out = getCheckpointSummary(checkpoint({ summary: long }), 200)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBe(201)
  })

  it('does not truncate when within the limit', () => {
    expect(getCheckpointSummary(checkpoint({ summary: 'short' }), 200)).toBe(
      'short',
    )
  })
})

describe('getCheckpointFullSummary', () => {
  it('returns the trimmed summary or a placeholder', () => {
    expect(getCheckpointFullSummary(checkpoint({ summary: ' x ' }))).toBe('x')
    expect(getCheckpointFullSummary(checkpoint({ summary: null }))).toBe(
      'No checkpoint summary provided.',
    )
  })
})

describe('getCheckpointDiffStatParsed', () => {
  it('returns null when there is no diff stat', () => {
    expect(
      getCheckpointDiffStatParsed(checkpoint({ diff_stat: null })),
    ).toBeNull()
  })

  it('parses a well-formed JSON diff stat', () => {
    const parsed = getCheckpointDiffStatParsed(
      checkpoint({
        diff_stat: JSON.stringify({
          raw: 'src/a.ts | 3 ++-',
          changed_files: ['src/a.ts'],
          files_changed: 1,
        }),
      }),
    )
    expect(parsed).toEqual({
      raw: 'src/a.ts | 3 ++-',
      changedFiles: ['src/a.ts'],
      filesChanged: 1,
    })
  })

  it('defaults missing fields inside a valid JSON object', () => {
    const parsed = getCheckpointDiffStatParsed(checkpoint({ diff_stat: '{}' }))
    expect(parsed).toEqual({ raw: '', changedFiles: [], filesChanged: 0 })
  })

  it('returns null for non-JSON diff stat text', () => {
    expect(
      getCheckpointDiffStatParsed(checkpoint({ diff_stat: 'plain text' })),
    ).toBeNull()
  })
})

describe('getCheckpointDiffStat', () => {
  it('summarizes the changed file count from a parsed stat', () => {
    expect(
      getCheckpointDiffStat(
        checkpoint({
          diff_stat: JSON.stringify({ files_changed: 1, raw: 'x' }),
        }),
      ),
    ).toBe('1 file changed')
    expect(
      getCheckpointDiffStat(
        checkpoint({
          diff_stat: JSON.stringify({ files_changed: 3, raw: 'x' }),
        }),
      ),
    ).toBe('3 files changed')
  })

  it('falls back to the raw diff stat string when not parseable', () => {
    expect(
      getCheckpointDiffStat(checkpoint({ diff_stat: '  2 files  ' })),
    ).toBe('2 files')
  })

  it('returns a placeholder when there is no diff stat', () => {
    expect(getCheckpointDiffStat(checkpoint({ diff_stat: null }))).toBe(
      'No diff stat reported',
    )
  })
})

describe('getCheckpointCommitHashLabel', () => {
  it('returns the short hash when a commit hash exists', () => {
    expect(
      getCheckpointCommitHashLabel(
        checkpoint({ commit_hash: 'abcdef1234567' }),
      ),
    ).toBe('abcdef1')
  })

  it('returns null when there is no commit hash', () => {
    expect(
      getCheckpointCommitHashLabel(checkpoint({ commit_hash: null })),
    ).toBeNull()
    expect(
      getCheckpointCommitHashLabel(checkpoint({ commit_hash: '   ' })),
    ).toBeNull()
  })
})

describe('getCheckpointReviewSuccessMessage', () => {
  it('returns an action-specific success message', () => {
    expect(getCheckpointReviewSuccessMessage('approve')).toBe(
      'Checkpoint approved',
    )
    expect(getCheckpointReviewSuccessMessage('approve-and-commit')).toBe(
      'Checkpoint approved and committed',
    )
    expect(getCheckpointReviewSuccessMessage('approve-and-pr')).toBe(
      'Checkpoint approved and PR opened',
    )
    expect(getCheckpointReviewSuccessMessage('approve-and-merge')).toBe(
      'Checkpoint approved and merged',
    )
    expect(getCheckpointReviewSuccessMessage('revise')).toBe(
      'Checkpoint sent back for revision',
    )
    expect(getCheckpointReviewSuccessMessage('reject')).toBe(
      'Checkpoint rejected',
    )
  })
})

describe('getCheckpointReviewSubmitLabel', () => {
  it('returns the label for revise and reject', () => {
    expect(getCheckpointReviewSubmitLabel('revise')).toBe(
      'Send Revision Request',
    )
    expect(getCheckpointReviewSubmitLabel('reject')).toBe('Reject Checkpoint')
  })
})

describe('isCheckpointReviewable', () => {
  it('is true only for pending checkpoints', () => {
    expect(isCheckpointReviewable(checkpoint({ status: 'pending' }))).toBe(true)
    expect(isCheckpointReviewable(checkpoint({ status: 'approved' }))).toBe(
      false,
    )
  })
})

describe('firstPendingCheckpoint', () => {
  it('returns the first pending checkpoint', () => {
    const result = firstPendingCheckpoint([
      checkpoint({ id: 'a', status: 'approved' }),
      checkpoint({ id: 'b', status: 'pending' }),
      checkpoint({ id: 'c', status: 'pending' }),
    ])
    expect(result?.id).toBe('b')
  })

  it('returns null when none are pending', () => {
    expect(
      firstPendingCheckpoint([checkpoint({ status: 'approved' })]),
    ).toBeNull()
    expect(firstPendingCheckpoint([])).toBeNull()
  })
})

describe('sortCheckpointsNewestFirst', () => {
  it('sorts by created_at descending without mutating the input', () => {
    const input = [
      checkpoint({ id: 'old', created_at: '2026-03-01T00:00:00Z' }),
      checkpoint({ id: 'new', created_at: '2026-03-10T00:00:00Z' }),
      checkpoint({ id: 'mid', created_at: '2026-03-05T00:00:00Z' }),
    ]

    const sorted = sortCheckpointsNewestFirst(input)

    expect(sorted.map((c) => c.id)).toEqual(['new', 'mid', 'old'])
    // Original array order is preserved (non-mutating).
    expect(input.map((c) => c.id)).toEqual(['old', 'new', 'mid'])
  })
})
