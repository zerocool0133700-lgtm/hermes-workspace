import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteCronJob,
  fetchCronJobs,
  fetchCronRuns,
  runCronJob,
  runCronJobIfDue,
  toggleCronJob,
  upsertCronJob,
} from './cron-api'
import type { UpsertCronJobInput } from './cron-api'

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getFetchMock(): FetchMock {
  const candidate = globalThis.fetch
  if (!vi.isMockFunction(candidate)) {
    throw new Error('fetch is not mocked')
  }
  return candidate as FetchMock
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('fetchCronJobs', () => {
  it('requests the jobs endpoint and normalizes the returned rows', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({
        jobs: [
          {
            id: 'job-a',
            title: 'Daily digest',
            cron: '0 9 * * *',
            enabled: true,
            description: 'morning summary',
            status: 'idle',
          },
        ],
      }),
    )

    const jobs = await fetchCronJobs()

    expect(fetchMock).toHaveBeenCalledWith('/api/claude-jobs')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      id: 'job-a',
      name: 'Daily digest',
      schedule: '0 9 * * *',
      enabled: true,
      description: 'morning summary',
      status: 'idle',
    })
  })

  it('applies defaults for missing fields and treats a non-array jobs value as empty', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValueOnce(jsonResponse({ jobs: [{}] }))

    const [job] = await fetchCronJobs()
    expect(job).toMatchObject({
      id: 'job-0',
      name: 'Cron Job 1',
      schedule: '* * * * *',
      enabled: false,
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({ jobs: null }))
    expect(await fetchCronJobs()).toEqual([])

    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    expect(await fetchCronJobs()).toEqual([])
  })

  it('throws a friendly error when the croniter dependency is missing', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: "ModuleNotFoundError: No module named 'croniter'" },
        500,
      ),
    )

    await expect(fetchCronJobs()).rejects.toThrow(/pip install/)
  })

  it('throws the surfaced error message on a non-OK status', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ message: 'boom upstream' }, 502))

    await expect(fetchCronJobs()).rejects.toThrow('boom upstream')
  })

  it('falls back to status text when a non-OK response is not valid JSON', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      new Response('not json', {
        status: 503,
        statusText: 'Service Unavailable',
      }),
    )

    await expect(fetchCronJobs()).rejects.toThrow('Service Unavailable')
  })

  it('rejects when the payload reports ok:false even with an OK status', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'denied' }))

    await expect(fetchCronJobs()).rejects.toThrow('denied')
  })

  it('propagates a network rejection from fetch', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockRejectedValue(new Error('network down'))

    await expect(fetchCronJobs()).rejects.toThrow('network down')
  })
})

describe('fetchCronRuns', () => {
  it('requests the runs endpoint with an encoded job id and normalizes statuses/timestamps', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({
        runs: [
          {
            id: 'run-1',
            state: 'COMPLETED',
            startedAt: '2026-01-02T03:04:05.000Z',
            durationMs: 1234,
            summary: 'all good',
          },
        ],
      }),
    )

    const runs = await fetchCronRuns('jobs/with space')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/claude-jobs/jobs%2Fwith%20space?action=runs&limit=20',
    )
    expect(runs[0]).toMatchObject({
      id: 'run-1',
      status: 'success',
      startedAt: '2026-01-02T03:04:05.000Z',
      durationMs: 1234,
      deliverySummary: 'all good',
    })
  })

  it('normalizes numeric epoch-second timestamps and error states', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({
        runs: [
          { status: 'failed', started_at: 1_700_000_000, error: 'kaboom' },
        ],
      }),
    )

    const [run] = await fetchCronRuns('job-1')
    expect(run.status).toBe('error')
    expect(run.error).toBe('kaboom')
    expect(run.startedAt).toBe(new Date(1_700_000_000_000).toISOString())
  })

  it('returns an empty list when runs is not an array', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ runs: 'nope' }))

    expect(await fetchCronRuns('job-1')).toEqual([])
  })

  it('throws on a non-OK status', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ error: 'no such job' }, 404))

    await expect(fetchCronRuns('job-1')).rejects.toThrow('no such job')
  })
})

describe('runCronJob / runCronJobIfDue', () => {
  it('POSTs to the run action and returns the parsed payload', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    const result = await runCronJob('job-1')

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/claude-jobs/job-1?action=run',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    )
  })

  it('POSTs to the run-if-due action', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    await runCronJobIfDue('job-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/claude-jobs/job-1?action=run-if-due',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    )
  })

  it('rejects when the run payload reports ok:false', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, message: 'still running' }),
    )

    await expect(runCronJob('job-1')).rejects.toThrow('still running')
  })

  it('propagates an abort rejection from fetch', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockRejectedValue(
      new DOMException('The operation was aborted.', 'AbortError'),
    )

    await expect(runCronJob('job-1')).rejects.toThrow('aborted')
  })
})

describe('toggleCronJob', () => {
  it('PATCHes the job with the enabled flag in the body', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, enabled: false }))

    const result = await toggleCronJob({ jobId: 'job 1', enabled: false })

    expect(result).toEqual({ ok: true, enabled: false })
    expect(fetchMock).toHaveBeenCalledWith('/api/claude-jobs/job%201', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
  })

  it('throws on a non-OK status', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ error: 'forbidden' }, 403))

    await expect(
      toggleCronJob({ jobId: 'job-1', enabled: true }),
    ).rejects.toThrow('forbidden')
  })
})

describe('upsertCronJob', () => {
  it('POSTs to the collection endpoint when no jobId is present (create)', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, jobId: 'new-1' }))

    const input: UpsertCronJobInput = {
      name: 'New job',
      schedule: '0 0 * * *',
      enabled: true,
    }
    const result = await upsertCronJob(input)

    expect(result).toEqual({ ok: true, jobId: 'new-1' })
    expect(fetchMock).toHaveBeenCalledWith('/api/claude-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  })

  it('PATCHes the item endpoint when a jobId is present (update)', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, jobId: 'job-1' }))

    const input: UpsertCronJobInput = {
      jobId: 'job-1',
      name: 'Updated',
      schedule: '* * * * *',
      enabled: false,
    }
    await upsertCronJob(input)

    expect(fetchMock).toHaveBeenCalledWith('/api/claude-jobs/job-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  })

  it('throws the surfaced error message on a non-OK status', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'invalid schedule' }, 400),
    )

    await expect(
      upsertCronJob({ name: 'x', schedule: 'bad', enabled: true }),
    ).rejects.toThrow('invalid schedule')
  })
})

describe('deleteCronJob', () => {
  it('DELETEs the encoded job endpoint and returns the parsed payload', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    const result = await deleteCronJob('job/1')

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/claude-jobs/job%2F1', {
      method: 'DELETE',
    })
  })

  it('rejects on a non-OK status with the stringified payload when no error field exists', async () => {
    const fetchMock = getFetchMock()
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'gone' }, 410))

    await expect(deleteCronJob('job-1')).rejects.toThrow(
      JSON.stringify({ detail: 'gone' }),
    )
  })
})
