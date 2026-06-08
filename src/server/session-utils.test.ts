import { describe, expect, it } from 'vitest'

import {
  hasRealTitle,
  isInternalSessionKey,
  isSyntheticSessionKey,
  resolveMainChatSessionId,
  resolveSessionKey,
  shouldBindMainToPortableSession,
} from './session-utils'

type SessionFixture = {
  id: string
  title?: string | null
  message_count?: number | null
}

describe('isInternalSessionKey', () => {
  it('flags cron_-prefixed ids', () => {
    expect(isInternalSessionKey('cron_123')).toBe(true)
  })

  it('flags cron:-prefixed ids', () => {
    expect(isInternalSessionKey('cron:nightly')).toBe(true)
  })

  it('flags agent:main:ops- prefixed ids', () => {
    expect(isInternalSessionKey('agent:main:ops-cleanup')).toBe(true)
  })

  it('does not flag ordinary session ids', () => {
    expect(isInternalSessionKey('abc123')).toBe(false)
    expect(isInternalSessionKey('session-42')).toBe(false)
  })

  it('does not flag near-miss prefixes', () => {
    expect(isInternalSessionKey('cron')).toBe(false)
    expect(isInternalSessionKey('agent:main:ops')).toBe(false)
    expect(isInternalSessionKey('agent:main:other-')).toBe(false)
    expect(isInternalSessionKey('xcron_1')).toBe(false)
  })

  it('treats the empty string as not internal', () => {
    expect(isInternalSessionKey('')).toBe(false)
  })
})

describe('hasRealTitle', () => {
  it('is true when a non-empty title differs from the id', () => {
    expect(hasRealTitle({ id: 'abc', title: 'My Chat' })).toBe(true)
  })

  it('is false when the title is missing (undefined)', () => {
    expect(hasRealTitle({ id: 'abc' })).toBe(false)
  })

  it('is false when the title is null', () => {
    expect(hasRealTitle({ id: 'abc', title: null })).toBe(false)
  })

  it('is false when the title is an empty or whitespace-only string', () => {
    expect(hasRealTitle({ id: 'abc', title: '' })).toBe(false)
    expect(hasRealTitle({ id: 'abc', title: '   ' })).toBe(false)
  })

  it('is false when the trimmed title equals the id', () => {
    expect(hasRealTitle({ id: 'abc', title: 'abc' })).toBe(false)
    expect(hasRealTitle({ id: 'abc', title: '  abc  ' })).toBe(false)
  })

  it('compares the trimmed title for non-empty checks', () => {
    expect(hasRealTitle({ id: 'abc', title: '  Real Title  ' })).toBe(true)
  })
})

describe('resolveMainChatSessionId', () => {
  it('returns null for an empty list', () => {
    expect(resolveMainChatSessionId([])).toBeNull()
  })

  it('prefers the first non-internal session with a real title', () => {
    const sessions: Array<SessionFixture> = [
      { id: 's1', title: '' },
      { id: 's2', title: 'Titled Chat', message_count: 0 },
    ]
    expect(resolveMainChatSessionId(sessions)).toBe('s2')
  })

  it('skips internal sessions even when they have real titles', () => {
    const sessions: Array<SessionFixture> = [
      { id: 'cron_1', title: 'Nightly Job' },
      { id: 's2', title: 'Real Chat' },
    ]
    expect(resolveMainChatSessionId(sessions)).toBe('s2')
  })

  it('falls back to a non-internal session with a positive message_count', () => {
    const sessions: Array<SessionFixture> = [
      { id: 's1', title: null, message_count: 0 },
      { id: 's2', title: '', message_count: 5 },
    ]
    expect(resolveMainChatSessionId(sessions)).toBe('s2')
  })

  it('does not fall back when no titled session and no messaged session exist', () => {
    const sessions: Array<SessionFixture> = [
      { id: 's1', title: '', message_count: 0 },
      { id: 's2', title: null },
    ]
    expect(resolveMainChatSessionId(sessions)).toBeNull()
  })

  it('ignores internal sessions during the message_count fallback', () => {
    const sessions: Array<SessionFixture> = [
      { id: 'cron_1', title: '', message_count: 99 },
      { id: 's2', title: '', message_count: 3 },
    ]
    expect(resolveMainChatSessionId(sessions)).toBe('s2')
  })

  it('does not fall back on a non-numeric or non-positive message_count', () => {
    const sessions: Array<SessionFixture> = [
      { id: 's1', title: '', message_count: null },
      { id: 's2', title: '', message_count: 0 },
    ]
    expect(resolveMainChatSessionId(sessions)).toBeNull()
  })

  it('prefers a titled session over an earlier messaged session', () => {
    const sessions: Array<SessionFixture> = [
      { id: 's1', title: '', message_count: 10 },
      { id: 's2', title: 'Has Title' },
    ]
    expect(resolveMainChatSessionId(sessions)).toBe('s2')
  })
})

describe('isSyntheticSessionKey', () => {
  it('is true for "main" and "new"', () => {
    expect(isSyntheticSessionKey('main')).toBe(true)
    expect(isSyntheticSessionKey('new')).toBe(true)
  })

  it('matches after trimming whitespace', () => {
    expect(isSyntheticSessionKey('  main  ')).toBe(true)
    expect(isSyntheticSessionKey('\tnew\n')).toBe(true)
  })

  it('is false for null and undefined', () => {
    expect(isSyntheticSessionKey(null)).toBe(false)
    expect(isSyntheticSessionKey(undefined)).toBe(false)
  })

  it('is false for the empty string', () => {
    expect(isSyntheticSessionKey('')).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(isSyntheticSessionKey('Main')).toBe(false)
    expect(isSyntheticSessionKey('NEW')).toBe(false)
  })

  it('is false for arbitrary keys', () => {
    expect(isSyntheticSessionKey('session-1')).toBe(false)
    expect(isSyntheticSessionKey('mainline')).toBe(false)
  })
})

describe('shouldBindMainToPortableSession', () => {
  it('is true only when sessionKey is main, dashboard available, and chat not enhanced', () => {
    expect(
      shouldBindMainToPortableSession({
        sessionKey: 'main',
        dashboardAvailable: true,
        enhancedChat: false,
      }),
    ).toBe(true)
  })

  it('trims the session key before comparing to main', () => {
    expect(
      shouldBindMainToPortableSession({
        sessionKey: '  main  ',
        dashboardAvailable: true,
        enhancedChat: false,
      }),
    ).toBe(true)
  })

  it('is false when the session key is not main', () => {
    expect(
      shouldBindMainToPortableSession({
        sessionKey: 'new',
        dashboardAvailable: true,
        enhancedChat: false,
      }),
    ).toBe(false)
  })

  it('is false when the session key is null or undefined', () => {
    expect(
      shouldBindMainToPortableSession({
        sessionKey: null,
        dashboardAvailable: true,
        enhancedChat: false,
      }),
    ).toBe(false)
    expect(
      shouldBindMainToPortableSession({
        sessionKey: undefined,
        dashboardAvailable: true,
        enhancedChat: false,
      }),
    ).toBe(false)
  })

  it('is false when the dashboard is unavailable', () => {
    expect(
      shouldBindMainToPortableSession({
        sessionKey: 'main',
        dashboardAvailable: false,
        enhancedChat: false,
      }),
    ).toBe(false)
  })

  it('is false when enhanced chat is active', () => {
    expect(
      shouldBindMainToPortableSession({
        sessionKey: 'main',
        dashboardAvailable: true,
        enhancedChat: true,
      }),
    ).toBe(false)
  })
})

describe('resolveSessionKey', () => {
  it('resolves via raw when a non-empty rawSessionKey is provided', async () => {
    await expect(
      resolveSessionKey({ rawSessionKey: 'sess-1' }),
    ).resolves.toEqual({ sessionKey: 'sess-1', resolvedVia: 'raw' })
  })

  it('trims the raw session key', async () => {
    await expect(
      resolveSessionKey({ rawSessionKey: '  sess-2  ' }),
    ).resolves.toEqual({ sessionKey: 'sess-2', resolvedVia: 'raw' })
  })

  it('prefers raw over friendly and default', async () => {
    await expect(
      resolveSessionKey({
        rawSessionKey: 'raw-key',
        friendlyId: 'friendly',
        defaultKey: 'fallback',
      }),
    ).resolves.toEqual({ sessionKey: 'raw-key', resolvedVia: 'raw' })
  })

  it('falls through to friendly when raw is empty/whitespace', async () => {
    await expect(
      resolveSessionKey({ rawSessionKey: '   ', friendlyId: 'friend-1' }),
    ).resolves.toEqual({ sessionKey: 'friend-1', resolvedVia: 'friendly' })
  })

  it('trims the friendly id', async () => {
    await expect(
      resolveSessionKey({ friendlyId: '  friend-2  ' }),
    ).resolves.toEqual({ sessionKey: 'friend-2', resolvedVia: 'friendly' })
  })

  it('prefers friendly over default', async () => {
    await expect(
      resolveSessionKey({ friendlyId: 'friend-3', defaultKey: 'fallback' }),
    ).resolves.toEqual({ sessionKey: 'friend-3', resolvedVia: 'friendly' })
  })

  it('falls back to the default key "new" when nothing is provided', async () => {
    await expect(resolveSessionKey({})).resolves.toEqual({
      sessionKey: 'new',
      resolvedVia: 'default',
    })
  })

  it('honors a custom default key', async () => {
    await expect(
      resolveSessionKey({ defaultKey: 'custom-default' }),
    ).resolves.toEqual({ sessionKey: 'custom-default', resolvedVia: 'default' })
  })

  it('falls back to default when both raw and friendly are whitespace-only', async () => {
    await expect(
      resolveSessionKey({ rawSessionKey: '  ', friendlyId: '   ' }),
    ).resolves.toEqual({ sessionKey: 'new', resolvedVia: 'default' })
  })
})
