/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  shouldResolveStreamSession,
  useStreamingMessage,
} from './use-streaming-message'
import type { ChatMessage } from '../types'
// vi.mock calls below are hoisted above these imports by Vitest, so the hook
// module loads with the mocked collaborators in place.

// ---------------------------------------------------------------------------
// Module mocks
//
// The hook is wired to three side-effecting collaborators:
//   - `@/stores/chat-store`   (zustand store: selector-call + .getState())
//   - `@/lib/send-stream-session-headers` (reads resolved session headers)
//   - `@/components/inspector/activity-store` (pushActivity timeline writer)
//
// We replace all three with typed fakes so the test can focus on the hook's
// own observable behavior (state transitions, accumulation, finalization,
// error handling, cancellation) without dragging in the real store internals.
// ---------------------------------------------------------------------------

type ChatStoreSlice = {
  registerSendStreamRun: (runId: string) => void
  unregisterSendStreamRun: (runId: string) => void
  processEvent: (event: unknown) => void
  clearStreamingSession: (sessionKey: string) => void
  setHeartbeatActivity: (activity: string | null) => void
  streamingState: Map<string, unknown>
  lastEventAt: number
}

const chatStoreState: ChatStoreSlice = {
  registerSendStreamRun: vi.fn<(runId: string) => void>(),
  unregisterSendStreamRun: vi.fn<(runId: string) => void>(),
  processEvent: vi.fn<(event: unknown) => void>(),
  clearStreamingSession: vi.fn<(sessionKey: string) => void>(),
  setHeartbeatActivity: vi.fn<(activity: string | null) => void>(),
  streamingState: new Map<string, unknown>(),
  lastEventAt: 0,
}

type ChatStoreHook = {
  <T>(selector: (state: ChatStoreSlice) => T): T
  getState: () => ChatStoreSlice
}

vi.mock('@/stores/chat-store', () => {
  const useChatStore = (<T>(selector: (state: ChatStoreSlice) => T): T =>
    selector(chatStoreState)) as ChatStoreHook
  useChatStore.getState = () => chatStoreState
  return { useChatStore }
})

vi.mock('@/lib/send-stream-session-headers', () => ({
  readResolvedSessionHeaders: (
    _headers: unknown,
    fallback: { sessionKey: string; friendlyId: string },
  ) => fallback,
}))

const pushActivityMock = vi.fn<(event: unknown) => void>()
vi.mock('@/components/inspector/activity-store', () => ({
  pushActivity: (event: unknown) => pushActivityMock(event),
}))

describe('shouldResolveStreamSession', () => {
  it('does not promote backend api session ids over concrete Workspace sessions', () => {
    expect(
      shouldResolveStreamSession({
        requestedSessionKey: 'api-original-workspace',
        currentSessionKey: 'api-original-workspace',
        resolvedSessionKey: 'api-derived-backend',
      }),
    ).toBe(false)
  })

  it('allows bootstrap new chats to resolve once to a concrete session', () => {
    expect(
      shouldResolveStreamSession({
        requestedSessionKey: 'new',
        currentSessionKey: 'new',
        resolvedSessionKey: 'api-created-session',
      }),
    ).toBe(true)
  })

  it('keeps portable main chats pinned instead of promoting a backend session id', () => {
    expect(
      shouldResolveStreamSession({
        requestedSessionKey: 'main',
        currentSessionKey: 'main',
        resolvedSessionKey: 'existing-main-session',
        pinMainSession: true,
      }),
    ).toBe(false)
  })

  it('still resolves main chats when the route is not pinned to a portable session', () => {
    expect(
      shouldResolveStreamSession({
        requestedSessionKey: 'main',
        currentSessionKey: 'main',
        resolvedSessionKey: 'existing-main-session',
        pinMainSession: false,
      }),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SSE response helpers
// ---------------------------------------------------------------------------

/** Encode a single SSE event block (event + JSON data) the way the route does. */
function sseBlock(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

type FakeResponseInit = {
  ok?: boolean
  status?: number
  bodyText?: string
  /** Chunks to emit from the reader, in order. */
  chunks?: Array<string>
  /** Omit the body entirely to exercise the "No response body" path. */
  noBody?: boolean
}

/**
 * Build a minimal Response-like object whose body reader yields the supplied
 * SSE chunks one read() at a time, then signals done. Only the surface the
 * hook touches (ok/status/text/headers/body.getReader) is implemented.
 */
function makeFakeResponse(init: FakeResponseInit): Response {
  const encoder = new TextEncoder()
  const chunks = init.chunks ?? []
  let index = 0
  let cancelled = false

  const reader: ReadableStreamDefaultReader<Uint8Array> = {
    read() {
      if (cancelled || index >= chunks.length) {
        return Promise.resolve({ done: true, value: undefined })
      }
      const value = encoder.encode(chunks[index])
      index += 1
      return Promise.resolve({ done: false, value })
    },
    cancel() {
      cancelled = true
      return Promise.resolve()
    },
    releaseLock() {},
    closed: Promise.resolve(undefined),
  }

  const body = init.noBody
    ? null
    : ({
        getReader: () => reader,
      } as unknown as ReadableStream<Uint8Array>)

  const response = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers(),
    body,
    text: () => Promise.resolve(init.bodyText ?? ''),
  }

  return response as unknown as Response
}

/** Install a fetch stub returning the given response (or rejecting). */
function stubFetch(
  responder: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
): void {
  vi.stubGlobal('fetch', vi.fn(responder))
}

const startParams = {
  sessionKey: 'session-1',
  friendlyId: 'friendly-1',
  message: 'hello',
}

beforeEach(() => {
  vi.clearAllMocks()
  chatStoreState.streamingState = new Map()
  chatStoreState.lastEventAt = 0
  // Make requestAnimationFrame deterministic so the accumulation typewriter
  // loop advances within waitFor windows instead of depending on a real vsync.
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: FrameRequestCallback): number =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number,
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useStreamingMessage', () => {
  it('starts in idle state with no streaming text or error', () => {
    const { result } = renderHook(() => useStreamingMessage())

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingMessageId).toBeNull()
    expect(result.current.streamingText).toBe('')
    expect(result.current.error).toBeNull()
    expect(typeof result.current.startStreaming).toBe('function')
    expect(typeof result.current.cancelStreaming).toBe('function')
    expect(typeof result.current.resetStreaming).toBe('function')
  })

  it('accumulates streamed chunks and finalizes on done', async () => {
    stubFetch(() =>
      Promise.resolve(
        makeFakeResponse({
          chunks: [
            sseBlock('started', { runId: 'run-1' }),
            sseBlock('chunk', { delta: 'Hello' }),
            sseBlock('chunk', { delta: ', world' }),
            sseBlock('done', { state: 'final' }),
          ],
        }),
      ),
    )

    const onComplete = vi.fn<(message: ChatMessage) => void>()
    const onChunk = vi.fn<(text: string, fullText: string) => void>()
    const { result } = renderHook(() =>
      useStreamingMessage({ onComplete, onChunk }),
    )

    await act(async () => {
      await result.current.startStreaming(startParams)
    })

    // Stream is done: finishStream flips isStreaming off and exposes full text.
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.streamingText).toBe('Hello, world')

    // The completed message carries the accumulated text + completion marker.
    const message = onComplete.mock.calls[0][0]
    expect(message.role).toBe('assistant')
    expect(message.__streamingStatus).toBe('complete')
    expect(message.content).toContainEqual({
      type: 'text',
      text: 'Hello, world',
    })

    // runId was registered on `started`.
    expect(chatStoreState.registerSendStreamRun).toHaveBeenCalledWith('run-1')

    // The accumulated text was forwarded to the chat store as chunk events,
    // proving each `chunk` delta was appended to the running fullText (the
    // final processEvent chunk carries the fully-accumulated string).
    type StoreChunkEvent = { type?: string; text?: string }
    const chunkTexts = vi
      .mocked(chatStoreState.processEvent)
      .mock.calls.map(([event]) => event as StoreChunkEvent)
      .filter((event) => event.type === 'chunk')
      .map((event) => event.text)
    expect(chunkTexts).toContain('Hello')
    expect(chunkTexts).toContain('Hello, world')

    // onChunk is an animation-frame callback; if the typewriter advanced it
    // must only ever report a prefix of the final text.
    for (const [, fullText] of onChunk.mock.calls) {
      expect('Hello, world'.startsWith(fullText)).toBe(true)
    }
  })

  it('accumulates `assistant` events as full-text replacements', async () => {
    stubFetch(() =>
      Promise.resolve(
        makeFakeResponse({
          chunks: [
            sseBlock('started', { runId: 'run-a' }),
            sseBlock('assistant', { text: 'first pass' }),
            sseBlock('assistant', { text: 'first pass then more' }),
            sseBlock('complete', {}),
          ],
        }),
      ),
    )

    const onComplete = vi.fn<(message: ChatMessage) => void>()
    const { result } = renderHook(() => useStreamingMessage({ onComplete }))

    await act(async () => {
      await result.current.startStreaming(startParams)
    })

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1)
    })
    expect(result.current.streamingText).toBe('first pass then more')
  })

  it('marks isStreaming true synchronously when a stream starts', () => {
    // A fetch that never resolves keeps the hook in the "requesting" phase so
    // we can observe the synchronous optimistic state set before await fetch.
    stubFetch(() => new Promise<Response>(() => {}))

    const { result } = renderHook(() => useStreamingMessage())

    act(() => {
      void result.current.startStreaming(startParams)
    })

    expect(result.current.isStreaming).toBe(true)
    expect(result.current.streamingMessageId).toMatch(/^streaming-/)
    expect(result.current.error).toBeNull()
  })

  it('reports an error via state and onError when the request fails (non-ok)', async () => {
    stubFetch(() =>
      Promise.resolve(
        makeFakeResponse({ ok: false, status: 500, bodyText: 'boom' }),
      ),
    )

    const onError = vi.fn<(error: string) => void>()
    const { result } = renderHook(() => useStreamingMessage({ onError }))

    await act(async () => {
      await result.current.startStreaming(startParams)
    })

    await waitFor(() => {
      expect(result.current.error).toBe('boom')
    })
    expect(result.current.isStreaming).toBe(false)
    expect(onError).toHaveBeenCalledWith('boom')
  })

  it('surfaces a server "done: error" event as an error state', async () => {
    stubFetch(() =>
      Promise.resolve(
        makeFakeResponse({
          chunks: [
            sseBlock('started', { runId: 'run-err' }),
            sseBlock('done', {
              state: 'error',
              errorMessage: 'model exploded',
            }),
          ],
        }),
      ),
    )

    const onError = vi.fn<(error: string) => void>()
    const onComplete = vi.fn<(message: ChatMessage) => void>()
    const { result } = renderHook(() =>
      useStreamingMessage({ onError, onComplete }),
    )

    await act(async () => {
      await result.current.startStreaming(startParams)
    })

    await waitFor(() => {
      expect(result.current.error).toBe('model exploded')
    })
    expect(result.current.isStreaming).toBe(false)
    expect(onError).toHaveBeenCalledWith('model exploded')
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('treats a fetch rejection (network error) as a failure', async () => {
    stubFetch(() => Promise.reject(new Error('network down')))

    const onError = vi.fn<(error: string) => void>()
    const { result } = renderHook(() => useStreamingMessage({ onError }))

    await act(async () => {
      await result.current.startStreaming(startParams)
    })

    await waitFor(() => {
      expect(result.current.error).toBe('network down')
    })
    expect(onError).toHaveBeenCalledWith('network down')
  })

  it('invokes onAbort and clears streaming when the fetch is aborted', async () => {
    // Reject with an AbortError to drive the abort branch of startStreaming.
    stubFetch(() => {
      const abortErr = new Error('aborted')
      abortErr.name = 'AbortError'
      return Promise.reject(abortErr)
    })

    const onAbort = vi.fn<() => void>()
    const onError = vi.fn<(error: string) => void>()
    const { result } = renderHook(() =>
      useStreamingMessage({ onAbort, onError }),
    )

    await act(async () => {
      await result.current.startStreaming(startParams)
    })

    await waitFor(() => {
      expect(onAbort).toHaveBeenCalledTimes(1)
    })
    // Abort is not an error.
    expect(onError).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
    expect(result.current.isStreaming).toBe(false)
  })

  it('resetStreaming returns the hook to its initial idle state', async () => {
    stubFetch(() =>
      Promise.resolve(
        makeFakeResponse({
          chunks: [
            sseBlock('started', { runId: 'run-reset' }),
            sseBlock('chunk', { delta: 'partial' }),
            sseBlock('done', { state: 'final' }),
          ],
        }),
      ),
    )

    const { result } = renderHook(() => useStreamingMessage())

    await act(async () => {
      await result.current.startStreaming(startParams)
    })
    await waitFor(() => {
      expect(result.current.streamingText).toBe('partial')
    })

    act(() => {
      result.current.resetStreaming()
    })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingMessageId).toBeNull()
    expect(result.current.streamingText).toBe('')
    expect(result.current.error).toBeNull()
  })

  it('does not abort an already-accepted in-flight run on unmount (handoff)', async () => {
    // A stream that reaches "accepted" (HTTP 200, reader open) but never emits
    // done lets us unmount mid-flight. The cleanup deliberately keeps the run
    // alive rather than aborting/resetting it, so a reset-style
    // clearStreamingSession must NOT fire for the active session on unmount.
    stubFetch(() =>
      Promise.resolve(
        makeFakeResponse({
          chunks: [sseBlock('started', { runId: 'run-handoff' })],
        }),
      ),
    )

    const { result, unmount } = renderHook(() => useStreamingMessage())

    await act(async () => {
      await result.current.startStreaming(startParams)
    })

    const clearCallsBeforeUnmount = vi.mocked(
      chatStoreState.clearStreamingSession,
    ).mock.calls.length

    act(() => {
      unmount()
    })

    // Cleanup must not perform a reset-style clearStreamingSession that would
    // make the UI look like Hermes stopped thinking; the run is handed off.
    expect(
      vi.mocked(chatStoreState.clearStreamingSession).mock.calls.length,
    ).toBe(clearCallsBeforeUnmount)
  })

  it('fails when the response has no body to read', async () => {
    stubFetch(() => Promise.resolve(makeFakeResponse({ noBody: true })))

    const onError = vi.fn<(error: string) => void>()
    const { result } = renderHook(() => useStreamingMessage({ onError }))

    await act(async () => {
      await result.current.startStreaming(startParams)
    })

    await waitFor(() => {
      expect(result.current.error).toBe('No response body')
    })
    expect(onError).toHaveBeenCalledWith('No response body')
  })
})
