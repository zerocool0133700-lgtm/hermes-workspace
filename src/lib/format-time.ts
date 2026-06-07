/**
 * Canonical relative-time formatting — single source of truth.
 *
 * Use this for every "X ago" label across the app. Do NOT re-implement
 * relative-time logic in individual screens/widgets; import from here.
 */

export type RelativeTimeGranularity = 'minutes' | 'seconds'

export interface FormatRelativeTimeOptions {
  /**
   * Controls how sub-minute durations are rendered:
   *   - 'minutes' (default): durations under one minute render as "just now".
   *   - 'seconds': durations under one minute render as "<n>s ago".
   */
  granularity?: RelativeTimeGranularity
}

/**
 * Formats an absolute epoch timestamp (in MILLISECONDS) as a relative
 * "time ago" string.
 *
 * IMPORTANT: the input is epoch milliseconds (e.g. `Date.now()` or
 * `new Date(...).getTime()`). Callers holding Unix *seconds* must convert
 * to milliseconds first (`seconds * 1000`).
 *
 * Examples (granularity: 'minutes', the default):
 *   formatRelativeTime(Date.now() - 30_000)      → "just now"
 *   formatRelativeTime(Date.now() - 2 * 60_000)  → "2m ago"
 *   formatRelativeTime(Date.now() - 3 * 3_600_000)  → "3h ago"
 *   formatRelativeTime(Date.now() - 2 * 86_400_000) → "2d ago"
 *
 * Examples (granularity: 'seconds'):
 *   formatRelativeTime(Date.now() - 5_000, { granularity: 'seconds' }) → "5s ago"
 *
 * Edge cases: a missing/zero/non-positive/future timestamp renders as
 * "just now" (or "0s ago" with seconds granularity).
 */
export function formatRelativeTime(
  epochMs: number,
  options: FormatRelativeTimeOptions = {},
): string {
  const granularity = options.granularity ?? 'minutes'
  if (!epochMs || epochMs <= 0) {
    return granularity === 'seconds' ? '0s ago' : 'just now'
  }
  const diffMs = Math.max(0, Date.now() - epochMs)
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) {
    return granularity === 'seconds' ? `${seconds}s ago` : 'just now'
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
