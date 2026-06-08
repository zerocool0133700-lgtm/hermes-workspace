import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from './chat-store'
import type { ChatStreamEvent, StreamingState } from './chat-store'
import type { ChatMessage } from '../screens/chat/types'

function textMessage(
  id: string,
  role: string,
  text: string,
  historyIndex: number,
): ChatMessage {
  return {
    id,
    role,
    timestamp: 1_700_000_000_000,
    __historyIndex: historyIndex,
    content: [{ type: 'text', text }],
  }
}

/** Build an assistant ChatMessage with a single text content block. */
function assistantMessage(
  text: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    ...extra,
  }
}

/** Build a user ChatMessage with a single text content block. */
function userMessage(
  text: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    ...extra,
  }
}

/**
 * Reset the singleton store to a clean slate before each test. The store is a
 * module-level singleton, so leaking state between tests would make assertions
 * non-deterministic.
 */
function resetStore(): void {
  useChatStore.setState({
    connectionState: 'disconnected',
    lastError: null,
    realtimeMessages: new Map(),
    streamingState: new Map(),
    lastEventAt: 0,
    sendStreamRunIds: new Set(),
    waitingSessionKeys: new Set(),
    waitingSessionMeta: {},
    heartbeatActivity: null,
  })
}

beforeEach(() => {
  resetStore()
})

describe('chat-store history merge ordering', () => {
  it('preserves persisted history order when messages share a timestamp', () => {
    const messages: Array<ChatMessage> = [
      textMessage('m1', 'user', 'first question', 0),
      textMessage('m2', 'assistant', 'first answer', 1),
      textMessage('m3', 'user', 'follow-up', 2),
    ]

    const merged = useChatStore
      .getState()
      .mergeHistoryMessages('history-order-session', messages)

    expect(merged.map((message) => message.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('accepts local-store historyIndex as a persisted order hint', () => {
    const messages: Array<ChatMessage> = [
      {
        id: 'local-1',
        role: 'user',
        timestamp: 1_700_000_000_000,
        historyIndex: 0,
        content: [{ type: 'text', text: 'local question' }],
      },
      {
        id: 'local-2',
        role: 'assistant',
        timestamp: 1_700_000_000_000,
        historyIndex: 1,
        content: [{ type: 'text', text: 'local answer' }],
      },
      {
        id: 'local-3',
        role: 'user',
        timestamp: 1_700_000_000_000,
        historyIndex: 2,
        content: [{ type: 'text', text: 'local follow-up' }],
      },
    ]

    const merged = useChatStore
      .getState()
      .mergeHistoryMessages('local-history-order-session', messages)

    expect(merged.map((message) => message.id)).toEqual([
      'local-1',
      'local-2',
      'local-3',
    ])
  })
})

describe('chat-store connection state', () => {
  it('sets connection state without an error', () => {
    useChatStore.getState().setConnectionState('connected')
    expect(useChatStore.getState().connectionState).toBe('connected')
    expect(useChatStore.getState().lastError).toBeNull()
  })

  it('sets connection state with an error message', () => {
    useChatStore.getState().setConnectionState('error', 'boom')
    expect(useChatStore.getState().connectionState).toBe('error')
    expect(useChatStore.getState().lastError).toBe('boom')
  })

  it('clears a previous error when a new state has no error', () => {
    useChatStore.getState().setConnectionState('error', 'boom')
    useChatStore.getState().setConnectionState('connecting')
    expect(useChatStore.getState().lastError).toBeNull()
  })
})

describe('chat-store send-stream run registry', () => {
  it('registers and detects a send-stream run id', () => {
    const store = useChatStore.getState()
    expect(store.isSendStreamRun('run-1')).toBe(false)
    store.registerSendStreamRun('run-1')
    expect(useChatStore.getState().isSendStreamRun('run-1')).toBe(true)
  })

  it('unregisters a run id', () => {
    const store = useChatStore.getState()
    store.registerSendStreamRun('run-1')
    store.unregisterSendStreamRun('run-1')
    expect(useChatStore.getState().isSendStreamRun('run-1')).toBe(false)
  })

  it('returns false for an undefined run id', () => {
    expect(useChatStore.getState().isSendStreamRun(undefined)).toBe(false)
  })
})

describe('chat-store processEvent: chunk', () => {
  const sessionKey = 'chunk-session'

  it('starts a streaming session on the first chunk', () => {
    useChatStore.getState().processEvent({
      type: 'chunk',
      text: 'Hello',
      sessionKey,
      runId: 'r1',
    })
    const state = useChatStore.getState().getStreamingState(sessionKey)
    expect(state).not.toBeNull()
    expect(state?.text).toBe('Hello')
    expect(state?.runId).toBe('r1')
  })

  it('replaces text by default (server sends full accumulated text)', () => {
    const store = useChatStore.getState()
    store.processEvent({ type: 'chunk', text: 'Hello', sessionKey })
    store.processEvent({ type: 'chunk', text: 'Hello world', sessionKey })
    expect(useChatStore.getState().getStreamingState(sessionKey)?.text).toBe(
      'Hello world',
    )
  })

  it('appends text when fullReplace is explicitly false', () => {
    const store = useChatStore.getState()
    store.processEvent({ type: 'chunk', text: 'Hello', sessionKey })
    store.processEvent({
      type: 'chunk',
      text: ' world',
      sessionKey,
      fullReplace: false,
    })
    expect(useChatStore.getState().getStreamingState(sessionKey)?.text).toBe(
      'Hello world',
    )
  })

  it('strips <final> wrapper tags from chunk text', () => {
    useChatStore.getState().processEvent({
      type: 'chunk',
      text: '<final>done text</final>',
      sessionKey,
    })
    expect(useChatStore.getState().getStreamingState(sessionKey)?.text).toBe(
      'done text',
    )
  })

  it('preserves the runId from a prior chunk when later chunks omit it', () => {
    const store = useChatStore.getState()
    store.processEvent({ type: 'chunk', text: 'a', sessionKey, runId: 'r9' })
    store.processEvent({ type: 'chunk', text: 'ab', sessionKey })
    expect(useChatStore.getState().getStreamingState(sessionKey)?.runId).toBe(
      'r9',
    )
  })

  it('updates lastEventAt', () => {
    expect(useChatStore.getState().lastEventAt).toBe(0)
    useChatStore
      .getState()
      .processEvent({ type: 'chunk', text: 'a', sessionKey })
    expect(useChatStore.getState().lastEventAt).toBeGreaterThan(0)
  })
})

describe('chat-store processEvent: thinking', () => {
  const sessionKey = 'thinking-session'

  it('records thinking text', () => {
    useChatStore.getState().processEvent({
      type: 'thinking',
      text: 'reasoning...',
      sessionKey,
      runId: 'r1',
    })
    const state = useChatStore.getState().getStreamingState(sessionKey)
    expect(state?.thinking).toBe('reasoning...')
    expect(state?.runId).toBe('r1')
  })

  it('replaces thinking text on the next thinking event', () => {
    const store = useChatStore.getState()
    store.processEvent({ type: 'thinking', text: 'first', sessionKey })
    store.processEvent({ type: 'thinking', text: 'second', sessionKey })
    expect(
      useChatStore.getState().getStreamingState(sessionKey)?.thinking,
    ).toBe('second')
  })

  it('coexists with streamed chunk text', () => {
    const store = useChatStore.getState()
    store.processEvent({ type: 'chunk', text: 'visible', sessionKey })
    store.processEvent({ type: 'thinking', text: 'hidden', sessionKey })
    const state = useChatStore.getState().getStreamingState(sessionKey)
    expect(state?.text).toBe('visible')
    expect(state?.thinking).toBe('hidden')
  })
})

describe('chat-store processEvent: status/lifecycle', () => {
  const sessionKey = 'lifecycle-session'

  it('appends a lifecycle event parsed from a status event', () => {
    useChatStore.getState().processEvent({
      type: 'status',
      text: '⏳ Working on it',
      sessionKey,
    })
    const events =
      useChatStore.getState().getStreamingState(sessionKey)?.lifecycleEvents ??
      []
    expect(events).toHaveLength(1)
    expect(events[0]?.emoji).toBe('⏳')
    expect(events[0]?.text).toBe('Working on it')
    expect(events[0]?.isError).toBe(false)
  })

  it('marks error lifecycle events from the ❌ emoji prefix', () => {
    useChatStore.getState().processEvent({
      type: 'lifecycle',
      text: '❌ Something broke',
      sessionKey,
    })
    const events =
      useChatStore.getState().getStreamingState(sessionKey)?.lifecycleEvents ??
      []
    expect(events[0]?.isError).toBe(true)
    expect(events[0]?.text).toBe('Something broke')
  })

  it('marks error lifecycle events from "failed" text without an emoji', () => {
    useChatStore.getState().processEvent({
      type: 'status',
      text: 'Tool failed unexpectedly',
      sessionKey,
    })
    const events =
      useChatStore.getState().getStreamingState(sessionKey)?.lifecycleEvents ??
      []
    expect(events[0]?.isError).toBe(true)
    expect(events[0]?.emoji).toBe('')
  })

  it('accumulates multiple lifecycle events in order', () => {
    const store = useChatStore.getState()
    store.processEvent({ type: 'status', text: 'one', sessionKey })
    store.processEvent({ type: 'lifecycle', text: 'two', sessionKey })
    const events =
      useChatStore.getState().getStreamingState(sessionKey)?.lifecycleEvents ??
      []
    expect(events.map((e) => e.text)).toEqual(['one', 'two'])
  })
})

describe('chat-store processEvent: tool', () => {
  const sessionKey = 'tool-session'

  it('creates a tool call entry on a start phase', () => {
    useChatStore.getState().processEvent({
      type: 'tool',
      phase: 'start',
      name: 'search',
      toolCallId: 'tc-1',
      args: { query: 'x' },
      sessionKey,
    })
    const toolCalls =
      useChatStore.getState().getStreamingState(sessionKey)?.toolCalls ?? []
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]).toMatchObject({
      id: 'tc-1',
      name: 'search',
      phase: 'start',
      args: { query: 'x' },
    })
  })

  it('updates an existing tool call by toolCallId across phases', () => {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'tool',
      phase: 'start',
      name: 'search',
      toolCallId: 'tc-1',
      sessionKey,
    })
    store.processEvent({
      type: 'tool',
      phase: 'complete',
      name: 'search',
      toolCallId: 'tc-1',
      result: 'found it',
      sessionKey,
    })
    const toolCalls =
      useChatStore.getState().getStreamingState(sessionKey)?.toolCalls ?? []
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.phase).toBe('complete')
    expect(toolCalls[0]?.result).toBe('found it')
  })

  it('preserves prior args/preview/result when a later phase omits them', () => {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'tool',
      phase: 'start',
      name: 'search',
      toolCallId: 'tc-1',
      args: { query: 'x' },
      preview: 'previewing',
      sessionKey,
    })
    store.processEvent({
      type: 'tool',
      phase: 'complete',
      name: 'search',
      toolCallId: 'tc-1',
      sessionKey,
    })
    const tc = useChatStore.getState().getStreamingState(sessionKey)
      ?.toolCalls[0]
    expect(tc?.args).toEqual({ query: 'x' })
    expect(tc?.preview).toBe('previewing')
  })

  it('synthesizes a toolCallId when none is provided', () => {
    useChatStore.getState().processEvent({
      type: 'tool',
      phase: 'start',
      name: 'mytool',
      runId: 'run-7',
      sessionKey,
    })
    const tc = useChatStore.getState().getStreamingState(sessionKey)
      ?.toolCalls[0]
    expect(tc?.id).toBe('mytool-run-7-0')
  })

  it('creates separate entries for distinct synthesized ids', () => {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'tool',
      phase: 'start',
      name: 'a',
      runId: 'run-1',
      sessionKey,
    })
    store.processEvent({
      type: 'tool',
      phase: 'start',
      name: 'b',
      runId: 'run-1',
      sessionKey,
    })
    const toolCalls =
      useChatStore.getState().getStreamingState(sessionKey)?.toolCalls ?? []
    expect(toolCalls).toHaveLength(2)
    expect(toolCalls.map((t) => t.id)).toEqual(['a-run-1-0', 'b-run-1-1'])
  })

  it('creates an entry for a terminal phase that arrives without a start', () => {
    useChatStore.getState().processEvent({
      type: 'tool',
      phase: 'complete',
      name: 'skill.loaded',
      toolCallId: 'skill-1',
      sessionKey,
    })
    const toolCalls =
      useChatStore.getState().getStreamingState(sessionKey)?.toolCalls ?? []
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.phase).toBe('complete')
  })
})

describe('chat-store processEvent: message / user_message', () => {
  const sessionKey = 'message-session'

  it('appends an assistant message to the realtime buffer', () => {
    useChatStore.getState().processEvent({
      type: 'message',
      message: assistantMessage('hi there', { id: 'a1' }),
      sessionKey,
    })
    const messages = useChatStore.getState().getRealtimeMessages(sessionKey)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.id).toBe('a1')
  })

  it('appends a user_message and tags the realtime source', () => {
    useChatStore.getState().processEvent({
      type: 'user_message',
      message: userMessage('hello', { id: 'u1' }),
      source: 'telegram',
      sessionKey,
    })
    const messages = useChatStore.getState().getRealtimeMessages(sessionKey)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.__realtimeSource).toBe('telegram')
  })

  it('dedupes messages with the same id', () => {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'message',
      message: assistantMessage('hi', { id: 'a1' }),
      sessionKey,
    })
    store.processEvent({
      type: 'message',
      message: assistantMessage('hi', { id: 'a1' }),
      sessionKey,
    })
    expect(
      useChatStore.getState().getRealtimeMessages(sessionKey),
    ).toHaveLength(1)
  })

  it('dedupes identical assistant text over 20 chars even with differing ids', () => {
    const longText = 'this is a sufficiently long assistant reply'
    const store = useChatStore.getState()
    store.processEvent({
      type: 'message',
      message: assistantMessage(longText, { id: 'a1' }),
      sessionKey,
    })
    store.processEvent({
      type: 'message',
      message: assistantMessage(longText, { id: 'a2' }),
      sessionKey,
    })
    expect(
      useChatStore.getState().getRealtimeMessages(sessionKey),
    ).toHaveLength(1)
  })

  it('dedupes identical short assistant content via the multipart signature', () => {
    // Identical content blocks produce identical multipart signatures, so even
    // short replies dedupe regardless of the >20-char content-text rule.
    const store = useChatStore.getState()
    store.processEvent({
      type: 'message',
      message: assistantMessage('short', { id: 'a1' }),
      sessionKey,
    })
    store.processEvent({
      type: 'message',
      message: assistantMessage('short', { id: 'a2' }),
      sessionKey,
    })
    const messages = useChatStore.getState().getRealtimeMessages(sessionKey)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.id).toBe('a1')
  })

  it('keeps assistant messages with differing content and differing ids', () => {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'message',
      message: assistantMessage('first distinct reply', { id: 'a1' }),
      sessionKey,
    })
    store.processEvent({
      type: 'message',
      message: assistantMessage('second distinct reply', { id: 'a2' }),
      sessionKey,
    })
    expect(
      useChatStore.getState().getRealtimeMessages(sessionKey),
    ).toHaveLength(2)
  })

  it('dedupes by client nonce when ids differ', () => {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'message',
      message: userMessage('hey', { id: 'u1', clientId: 'nonce-1' }),
      sessionKey,
    })
    store.processEvent({
      type: 'message',
      message: userMessage('hey', { id: 'u2', clientId: 'nonce-1' }),
      sessionKey,
    })
    expect(
      useChatStore.getState().getRealtimeMessages(sessionKey),
    ).toHaveLength(1)
  })

  it('strips <final> tags from assistant messages before storing', () => {
    useChatStore.getState().processEvent({
      type: 'message',
      message: assistantMessage('<final>clean answer</final>', { id: 'a1' }),
      sessionKey,
    })
    const stored = useChatStore.getState().getRealtimeMessages(sessionKey)[0]
    const content = stored?.content?.[0]
    expect(content?.type).toBe('text')
    if (content?.type === 'text') {
      expect(content.text).toBe('clean answer')
    }
  })

  it('filters internal pre-compaction memory flush user messages', () => {
    useChatStore.getState().processEvent({
      type: 'message',
      message: userMessage('Pre-compaction memory flush: do the thing'),
      sessionKey,
    })
    expect(
      useChatStore.getState().getRealtimeMessages(sessionKey),
    ).toHaveLength(0)
  })

  it('filters internal subagent-task user messages', () => {
    useChatStore.getState().processEvent({
      type: 'message',
      message: userMessage('A subagent task completed in the background'),
      sessionKey,
    })
    expect(
      useChatStore.getState().getRealtimeMessages(sessionKey),
    ).toHaveLength(0)
  })

  it('reconciles an optimistic user message with the server echo via nonce', () => {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'message',
      message: userMessage('typed message', {
        clientId: 'n1',
        status: 'sending',
        __optimisticId: 'opt-1',
      }),
      sessionKey,
    })
    store.processEvent({
      type: 'message',
      message: userMessage('typed message', { id: 'srv-1', clientId: 'n1' }),
      sessionKey,
    })
    const messages = useChatStore.getState().getRealtimeMessages(sessionKey)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.id).toBe('srv-1')
    expect(messages[0]?.__optimisticId).toBeUndefined()
    expect(messages[0]?.status).toBeUndefined()
  })

  it('reconciles an optimistic user message by matching text when nonce is absent', () => {
    // The optimistic candidate must carry a persisted marker (__optimisticId)
    // since processEvent clears `status` on stored messages — the text-match
    // reconciliation branch keys off isOptimisticUserCandidate.
    const store = useChatStore.getState()
    store.processEvent({
      type: 'message',
      message: userMessage('same text', { __optimisticId: 'opt-9' }),
      sessionKey,
    })
    store.processEvent({
      type: 'message',
      message: userMessage('same text', { id: 'srv-9' }),
      sessionKey,
    })
    const messages = useChatStore.getState().getRealtimeMessages(sessionKey)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.id).toBe('srv-9')
    expect(messages[0]?.__optimisticId).toBeUndefined()
  })

  it('dedupes two empty assistant placeholders by signature, keeping the first', () => {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'message',
      message: assistantMessage('', { id: 'empty-1' }),
      sessionKey,
    })
    store.processEvent({
      type: 'message',
      message: assistantMessage('', { id: 'empty-2' }),
      sessionKey,
    })
    const messages = useChatStore.getState().getRealtimeMessages(sessionKey)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.id).toBe('empty-1')
  })

  it('replaces a prior empty assistant placeholder when signatures differ', () => {
    const store = useChatStore.getState()
    // A first empty-text assistant carrying only a tool-call block has empty
    // plain text but a distinct multipart signature, so it is not deduped.
    store.processEvent({
      type: 'message',
      message: {
        role: 'assistant',
        id: 'empty-1',
        content: [{ type: 'toolCall', id: 'tc-a', name: 'first' }],
      },
      sessionKey,
    })
    // A second empty-text assistant with a different tool-call signature hits
    // the empty-placeholder replacement branch instead of appending.
    store.processEvent({
      type: 'message',
      message: {
        role: 'assistant',
        id: 'empty-2',
        content: [{ type: 'toolCall', id: 'tc-b', name: 'second' }],
      },
      sessionKey,
    })
    const messages = useChatStore.getState().getRealtimeMessages(sessionKey)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.id).toBe('empty-2')
  })

  it('drops a recent external-inbound duplicate user message within the time window', () => {
    const now = Date.now()
    const store = useChatStore.getState()
    store.processEvent({
      type: 'user_message',
      message: userMessage('ping', { id: 'x1', createdAt: now }),
      source: 'webchat',
      sessionKey,
    })
    store.processEvent({
      type: 'user_message',
      message: userMessage('ping', { id: 'x2', createdAt: now + 1000 }),
      source: 'signal',
      sessionKey,
    })
    expect(
      useChatStore.getState().getRealtimeMessages(sessionKey),
    ).toHaveLength(1)
  })
})

describe('chat-store processEvent: done', () => {
  const sessionKey = 'done-session'

  it('builds the final message from the done payload and clears streaming', () => {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'chunk',
      text: 'partial',
      sessionKey,
      runId: 'r',
    })
    store.processEvent({
      type: 'done',
      state: 'final',
      sessionKey,
      message: assistantMessage('the final answer', { id: 'final-1' }),
    })
    const messages = useChatStore.getState().getRealtimeMessages(sessionKey)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.id).toBe('final-1')
    expect(messages[0]?.__streamingStatus).toBe('complete')
    expect(useChatStore.getState().getStreamingState(sessionKey)).toBeNull()
  })

  it('marks interrupted state on the final message', () => {
    useChatStore.getState().processEvent({
      type: 'done',
      state: 'interrupted',
      sessionKey,
      message: assistantMessage('partial answer', { id: 'int-1' }),
    })
    const message = useChatStore.getState().getRealtimeMessages(sessionKey)[0]
    expect(message?.__streamingStatus).toBe('interrupted')
  })

  it('builds the final message from streaming state when no payload is given', () => {
    const store = useChatStore.getState()
    store.processEvent({ type: 'chunk', text: 'streamed body', sessionKey })
    store.processEvent({ type: 'thinking', text: 'my thoughts', sessionKey })
    store.processEvent({ type: 'done', state: 'final', sessionKey })
    const message = useChatStore.getState().getRealtimeMessages(sessionKey)[0]
    expect(message?.role).toBe('assistant')
    const texts = (message?.content ?? [])
      .filter((c): c is { type: 'text'; text?: string } => c.type === 'text')
      .map((c) => c.text)
    expect(texts).toContain('streamed body')
    const thinking = (message?.content ?? []).filter(
      (c) => c.type === 'thinking',
    )
    expect(thinking).toHaveLength(1)
  })

  it('embeds streaming tool calls onto the final message', () => {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'tool',
      phase: 'complete',
      name: 'search',
      toolCallId: 'tc-1',
      sessionKey,
    })
    store.processEvent({
      type: 'done',
      state: 'final',
      sessionKey,
      message: assistantMessage('answer', { id: 'f1' }),
    })
    const message = useChatStore.getState().getRealtimeMessages(sessionKey)[0]
    expect(message?.__streamToolCalls).toHaveLength(1)
    expect(message?.__streamToolCalls?.[0]?.id).toBe('tc-1')
  })

  it('produces no message when there is neither payload nor streamed text', () => {
    useChatStore.getState().processEvent({
      type: 'done',
      state: 'final',
      sessionKey,
    })
    expect(
      useChatStore.getState().getRealtimeMessages(sessionKey),
    ).toHaveLength(0)
  })

  it('replaces an existing tagged duplicate with the clean final message', () => {
    const store = useChatStore.getState()
    // Store a pre-final assistant message whose stripped text matches the final.
    store.processEvent({
      type: 'message',
      message: assistantMessage('the canonical reply text here', { id: 'pre' }),
      sessionKey,
    })
    store.processEvent({
      type: 'done',
      state: 'final',
      sessionKey,
      message: assistantMessage('the canonical reply text here', {
        id: 'pre',
        __extra: 'final-marker',
      }),
    })
    const messages = useChatStore.getState().getRealtimeMessages(sessionKey)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.__streamingStatus).toBe('complete')
    expect(messages[0]?.__extra).toBe('final-marker')
  })

  it('does not duplicate when the same final text is already present', () => {
    const longText = 'a long assistant message that should dedupe cleanly'
    const store = useChatStore.getState()
    store.processEvent({
      type: 'message',
      message: assistantMessage(longText, { id: 'm1' }),
      sessionKey,
    })
    store.processEvent({
      type: 'done',
      state: 'final',
      sessionKey,
      message: assistantMessage(longText, { id: 'm2' }),
    })
    expect(
      useChatStore.getState().getRealtimeMessages(sessionKey),
    ).toHaveLength(1)
  })
})

describe('chat-store processEvent: send-stream dedup gate', () => {
  const sessionKey = 'gate-session'

  it('skips chat-events for a runId registered with send-stream', () => {
    const store = useChatStore.getState()
    store.registerSendStreamRun('run-x')
    store.processEvent({
      type: 'chunk',
      text: 'should be ignored',
      runId: 'run-x',
      sessionKey,
      transport: 'chat-events',
    })
    expect(useChatStore.getState().getStreamingState(sessionKey)).toBeNull()
  })

  it('allows send-stream transport events for the same runId', () => {
    const store = useChatStore.getState()
    store.registerSendStreamRun('run-x')
    store.processEvent({
      type: 'chunk',
      text: 'authoritative',
      runId: 'run-x',
      sessionKey,
      transport: 'send-stream',
    })
    expect(useChatStore.getState().getStreamingState(sessionKey)?.text).toBe(
      'authoritative',
    )
  })

  it('allows events whose runId is not registered', () => {
    useChatStore.getState().processEvent({
      type: 'chunk',
      text: 'fine',
      runId: 'other-run',
      sessionKey,
      transport: 'chat-events',
    })
    expect(useChatStore.getState().getStreamingState(sessionKey)?.text).toBe(
      'fine',
    )
  })

  it('allows events without a runId even when other runs are registered', () => {
    const store = useChatStore.getState()
    store.registerSendStreamRun('run-x')
    store.processEvent({
      type: 'chunk',
      text: 'no run id',
      sessionKey,
      transport: 'chat-events',
    })
    expect(useChatStore.getState().getStreamingState(sessionKey)?.text).toBe(
      'no run id',
    )
  })
})

describe('chat-store streaming lifecycle', () => {
  const sessionKey = 'lifecycle-full'

  it('progresses start -> chunk -> tool -> done end to end', () => {
    const store = useChatStore.getState()
    store.processEvent({ type: 'chunk', text: 'Th', sessionKey, runId: 'r1' })
    store.processEvent({ type: 'chunk', text: 'Thinking done', sessionKey })
    store.processEvent({
      type: 'tool',
      phase: 'start',
      name: 'lookup',
      toolCallId: 't1',
      sessionKey,
    })
    store.processEvent({
      type: 'tool',
      phase: 'complete',
      name: 'lookup',
      toolCallId: 't1',
      result: 'ok',
      sessionKey,
    })

    const mid = useChatStore.getState().getStreamingState(sessionKey)
    expect(mid?.text).toBe('Thinking done')
    expect(mid?.toolCalls).toHaveLength(1)

    store.processEvent({
      type: 'done',
      state: 'final',
      sessionKey,
      message: assistantMessage('Thinking done', { id: 'done-1' }),
    })

    expect(useChatStore.getState().getStreamingState(sessionKey)).toBeNull()
    const messages = useChatStore.getState().getRealtimeMessages(sessionKey)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.__streamToolCalls).toHaveLength(1)
  })
})

describe('chat-store session clearing', () => {
  const sessionKey = 'clear-session'

  function seed(): void {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'message',
      message: assistantMessage('hi', { id: 'm1' }),
      sessionKey,
    })
    store.processEvent({ type: 'chunk', text: 'streaming', sessionKey })
  }

  it('clearSession removes both realtime and streaming state', () => {
    seed()
    useChatStore.getState().clearSession(sessionKey)
    expect(
      useChatStore.getState().getRealtimeMessages(sessionKey),
    ).toHaveLength(0)
    expect(useChatStore.getState().getStreamingState(sessionKey)).toBeNull()
  })

  it('clearRealtimeBuffer removes only realtime messages', () => {
    seed()
    useChatStore.getState().clearRealtimeBuffer(sessionKey)
    expect(
      useChatStore.getState().getRealtimeMessages(sessionKey),
    ).toHaveLength(0)
    expect(useChatStore.getState().getStreamingState(sessionKey)).not.toBeNull()
  })

  it('clearStreamingSession removes only streaming state', () => {
    seed()
    useChatStore.getState().clearStreamingSession(sessionKey)
    expect(useChatStore.getState().getStreamingState(sessionKey)).toBeNull()
    expect(
      useChatStore.getState().getRealtimeMessages(sessionKey),
    ).toHaveLength(1)
  })

  it('clearStreamingSession is a no-op when the session has no streaming state', () => {
    const before = useChatStore.getState().streamingState
    useChatStore.getState().clearStreamingSession('nonexistent')
    expect(useChatStore.getState().streamingState).toBe(before)
  })

  it('clearAllStreaming wipes every session streaming state', () => {
    const store = useChatStore.getState()
    store.processEvent({ type: 'chunk', text: 'a', sessionKey: 's1' })
    store.processEvent({ type: 'chunk', text: 'b', sessionKey: 's2' })
    store.clearAllStreaming()
    expect(useChatStore.getState().streamingState.size).toBe(0)
  })

  it('clearAllStreaming is a no-op when nothing is streaming', () => {
    const before = useChatStore.getState().streamingState
    useChatStore.getState().clearAllStreaming()
    expect(useChatStore.getState().streamingState).toBe(before)
  })
})

describe('chat-store waiting session state', () => {
  const sessionKey = 'waiting-session'

  it('marks a session as waiting with a run id', () => {
    useChatStore.getState().setSessionWaiting(sessionKey, 'run-1')
    expect(useChatStore.getState().isSessionWaiting(sessionKey)).toBe(true)
    expect(useChatStore.getState().waitingSessionMeta[sessionKey]?.runId).toBe(
      'run-1',
    )
  })

  it('defaults the run id to null when omitted', () => {
    useChatStore.getState().setSessionWaiting(sessionKey)
    expect(
      useChatStore.getState().waitingSessionMeta[sessionKey]?.runId,
    ).toBeNull()
  })

  it('preserves the original since timestamp across re-marks', () => {
    const store = useChatStore.getState()
    store.setSessionWaiting(sessionKey, 'run-1')
    const since = useChatStore.getState().waitingSessionMeta[sessionKey]?.since
    store.setSessionWaiting(sessionKey, 'run-2')
    expect(useChatStore.getState().waitingSessionMeta[sessionKey]?.since).toBe(
      since,
    )
    expect(useChatStore.getState().waitingSessionMeta[sessionKey]?.runId).toBe(
      'run-2',
    )
  })

  it('clears waiting state', () => {
    const store = useChatStore.getState()
    store.setSessionWaiting(sessionKey, 'run-1')
    store.clearSessionWaiting(sessionKey)
    expect(useChatStore.getState().isSessionWaiting(sessionKey)).toBe(false)
    expect(
      Object.hasOwn(useChatStore.getState().waitingSessionMeta, sessionKey),
    ).toBe(false)
  })
})

describe('chat-store heartbeat activity', () => {
  it('sets and clears heartbeat activity', () => {
    useChatStore.getState().setHeartbeatActivity('reading files')
    expect(useChatStore.getState().heartbeatActivity).toBe('reading files')
    useChatStore.getState().setHeartbeatActivity(null)
    expect(useChatStore.getState().heartbeatActivity).toBeNull()
  })
})

describe('chat-store mergeHistoryMessages', () => {
  const sessionKey = 'merge-session'

  it('returns sorted history untouched when there are no realtime messages', () => {
    const history: Array<ChatMessage> = [
      textMessage('h1', 'user', 'q', 0),
      textMessage('h2', 'assistant', 'a', 1),
    ]
    const merged = useChatStore
      .getState()
      .mergeHistoryMessages(sessionKey, history)
    expect(merged.map((m) => m.id)).toEqual(['h1', 'h2'])
  })

  it('dedupes a realtime message that also appears in history (by id)', () => {
    useChatStore.getState().processEvent({
      type: 'message',
      message: assistantMessage('shared answer text here', { id: 'dup' }),
      sessionKey,
    })
    const history: Array<ChatMessage> = [
      textMessage('q', 'user', 'question', 0),
      {
        id: 'dup',
        role: 'assistant',
        timestamp: 1_700_000_000_000,
        __historyIndex: 1,
        content: [{ type: 'text', text: 'shared answer text here' }],
      },
    ]
    const merged = useChatStore
      .getState()
      .mergeHistoryMessages(sessionKey, history)
    expect(merged.filter((m) => m.id === 'dup')).toHaveLength(1)
  })

  it('appends a realtime message that is not present in history', () => {
    useChatStore.getState().processEvent({
      type: 'message',
      message: assistantMessage('brand new realtime reply', { id: 'rt-1' }),
      sessionKey,
    })
    const history: Array<ChatMessage> = [textMessage('h1', 'user', 'q', 0)]
    const merged = useChatStore
      .getState()
      .mergeHistoryMessages(sessionKey, history)
    expect(merged.some((m) => m.id === 'rt-1')).toBe(true)
    expect(merged).toHaveLength(2)
  })

  it('matches a streaming-prefix realtime message against the full history text', () => {
    useChatStore.getState().processEvent({
      type: 'message',
      message: assistantMessage('partial', { id: 'rt-prefix' }),
      sessionKey,
    })
    const history: Array<ChatMessage> = [
      {
        id: 'srv',
        role: 'assistant',
        timestamp: 1_700_000_000_000,
        __historyIndex: 0,
        content: [{ type: 'text', text: 'partial then completed' }],
      },
    ]
    const merged = useChatStore
      .getState()
      .mergeHistoryMessages(sessionKey, history)
    // The realtime prefix should be merged away, leaving only the history msg.
    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe('srv')
  })

  it('carries realtime stream tool calls onto the matching history message', () => {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'tool',
      phase: 'complete',
      name: 'lookup',
      toolCallId: 'tc-merge',
      sessionKey,
    })
    store.processEvent({
      type: 'done',
      state: 'final',
      sessionKey,
      message: assistantMessage('answer with tools used', { id: 'rt-tools' }),
    })
    const history: Array<ChatMessage> = [
      {
        id: 'rt-tools',
        role: 'assistant',
        timestamp: 1_700_000_000_000,
        __historyIndex: 0,
        content: [{ type: 'text', text: 'answer with tools used' }],
      },
    ]
    const merged = useChatStore
      .getState()
      .mergeHistoryMessages(sessionKey, history)
    const histMsg = merged.find((m) => m.id === 'rt-tools')
    expect(histMsg?.__streamToolCalls).toHaveLength(1)
    expect(histMsg?.streamToolCalls).toHaveLength(1)
  })
})

describe('chat-store getStreamingState typing', () => {
  it('returns a fully-shaped StreamingState after events', () => {
    const sessionKey = 'typed-session'
    const store = useChatStore.getState()
    store.processEvent({ type: 'chunk', text: 'body', sessionKey, runId: 'r' })
    const state: StreamingState | null = store.getStreamingState(sessionKey)
    expect(state).not.toBeNull()
    if (state) {
      expect(state.runId).toBe('r')
      expect(Array.isArray(state.toolCalls)).toBe(true)
      expect(Array.isArray(state.lifecycleEvents)).toBe(true)
    }
  })
})

describe('chat-store event ordering edge cases', () => {
  const sessionKey = 'ordering-session'

  it('handles a done event arriving before any chunk (terminal-first)', () => {
    useChatStore.getState().processEvent({
      type: 'done',
      state: 'final',
      sessionKey,
      message: assistantMessage('out of order final', { id: 'oo-1' }),
    })
    const messages = useChatStore.getState().getRealtimeMessages(sessionKey)
    expect(messages).toHaveLength(1)
    expect(useChatStore.getState().getStreamingState(sessionKey)).toBeNull()
  })

  it('handles a tool complete arriving before its start', () => {
    const store = useChatStore.getState()
    store.processEvent({
      type: 'tool',
      phase: 'complete',
      name: 'x',
      toolCallId: 'tc-1',
      result: 'done',
      sessionKey,
    })
    store.processEvent({
      type: 'tool',
      phase: 'start',
      name: 'x',
      toolCallId: 'tc-1',
      sessionKey,
    })
    const toolCalls =
      useChatStore.getState().getStreamingState(sessionKey)?.toolCalls ?? []
    expect(toolCalls).toHaveLength(1)
    // The later 'start' event overwrites phase but preserves the earlier result.
    expect(toolCalls[0]?.phase).toBe('start')
    expect(toolCalls[0]?.result).toBe('done')
  })

  it('isolates streaming state across distinct sessions', () => {
    const store = useChatStore.getState()
    store.processEvent({ type: 'chunk', text: 'one', sessionKey: 'sess-a' })
    store.processEvent({ type: 'chunk', text: 'two', sessionKey: 'sess-b' })
    expect(useChatStore.getState().getStreamingState('sess-a')?.text).toBe(
      'one',
    )
    expect(useChatStore.getState().getStreamingState('sess-b')?.text).toBe(
      'two',
    )
  })
})

describe('chat-store getters with empty state', () => {
  it('getRealtimeMessages returns an empty array for an unknown session', () => {
    expect(useChatStore.getState().getRealtimeMessages('nope')).toEqual([])
  })

  it('getStreamingState returns null for an unknown session', () => {
    expect(useChatStore.getState().getStreamingState('nope')).toBeNull()
  })
})

// Exercise the ChatStreamEvent union exhaustively via a typed event list to
// confirm processEvent accepts every documented event kind without throwing.
describe('chat-store processEvent accepts every event kind', () => {
  it('processes each ChatStreamEvent variant', () => {
    const sessionKey = 'all-kinds'
    const events: Array<ChatStreamEvent> = [
      { type: 'chunk', text: 'c', sessionKey },
      { type: 'thinking', text: 't', sessionKey },
      { type: 'status', text: 's', sessionKey },
      { type: 'lifecycle', text: 'l', sessionKey },
      {
        type: 'tool',
        phase: 'start',
        name: 'n',
        toolCallId: 'tc',
        sessionKey,
      },
      {
        type: 'user_message',
        message: userMessage('hi from user'),
        sessionKey,
      },
      {
        type: 'message',
        message: assistantMessage('hi from assistant'),
        sessionKey,
      },
      {
        type: 'done',
        state: 'final',
        sessionKey,
        message: assistantMessage('the end of the stream'),
      },
    ]
    for (const event of events) {
      expect(() => useChatStore.getState().processEvent(event)).not.toThrow()
    }
    // After done, streaming state is cleared for the session.
    expect(useChatStore.getState().getStreamingState(sessionKey)).toBeNull()
  })
})
