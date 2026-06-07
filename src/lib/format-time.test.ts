import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRelativeTime } from './format-time'

const NOW = new Date('2026-06-07T12:00:00.000Z').getTime()

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('treats the input as epoch milliseconds', () => {
    // 2 minutes ago in ms.
    expect(formatRelativeTime(NOW - 2 * 60_000)).toBe('2m ago')
  })

  it('renders sub-minute durations as "just now" by default', () => {
    expect(formatRelativeTime(NOW - 30_000)).toBe('just now')
    expect(formatRelativeTime(NOW)).toBe('just now')
  })

  it('renders hours', () => {
    expect(formatRelativeTime(NOW - 3 * 3_600_000)).toBe('3h ago')
    expect(formatRelativeTime(NOW - 23 * 3_600_000)).toBe('23h ago')
  })

  it('renders days', () => {
    expect(formatRelativeTime(NOW - 2 * 86_400_000)).toBe('2d ago')
  })

  it('supports seconds granularity for sub-minute durations', () => {
    expect(formatRelativeTime(NOW - 5_000, { granularity: 'seconds' })).toBe(
      '5s ago',
    )
    // Above one minute the format is identical regardless of granularity.
    expect(formatRelativeTime(NOW - 90_000, { granularity: 'seconds' })).toBe(
      '1m ago',
    )
  })

  it('treats missing/non-positive/future timestamps as "just now"', () => {
    expect(formatRelativeTime(0)).toBe('just now')
    expect(formatRelativeTime(-1)).toBe('just now')
    expect(formatRelativeTime(NOW + 60_000)).toBe('just now')
    expect(formatRelativeTime(0, { granularity: 'seconds' })).toBe('0s ago')
  })

  it('demonstrates the crew-screen unit bug: ms must NOT be passed as seconds', () => {
    // The buggy crew-screen impl did `Date.now() - unixSeconds * 1000`,
    // i.e. it multiplied an already-ms timestamp by 1000, pushing it far
    // into the future and always rendering "just now"/"Just now".
    const fiveMinutesAgoMs = NOW - 5 * 60_000

    // Correct: pass the ms value directly.
    expect(formatRelativeTime(fiveMinutesAgoMs)).toBe('5m ago')

    // The old bug, reproduced: multiplying ms by 1000 yields a future
    // timestamp, which collapses to "just now".
    expect(formatRelativeTime(fiveMinutesAgoMs * 1000)).toBe('just now')
  })
})
