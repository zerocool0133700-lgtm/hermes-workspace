export type ToolCallContent = {
  type: 'toolCall'
  id?: string
  name?: string
  arguments?: Record<string, unknown>
  partialJson?: string
}

export type ToolResultContent = {
  type: 'toolResult'
  toolCallId?: string
  toolName?: string
  content?: Array<{ type?: string; text?: string }>
  details?: Record<string, unknown>
  isError?: boolean
}

export type TextContent = {
  type: 'text'
  text?: string
  textSignature?: string
}

export type ThinkingContent = {
  type: 'thinking'
  thinking?: string
  thinkingSignature?: string
}

export type SelectionCardContent = {
  type: 'selectionCard'
  id?: string
  title?: string
  body?: string
  mode?: 'single' | 'multi' | 'confirm'
  options?: Array<{
    id?: string
    label: string
    value?: string
    description?: string
  }>
  submitLabel?: string
}

export type MessageContent =
  | TextContent
  | ToolCallContent
  | ThinkingContent
  | SelectionCardContent

export type ChatAttachment = {
  id?: string
  name?: string
  contentType?: string
  size?: number
  url?: string
  dataUrl?: string
  previewUrl?: string
  width?: number
  height?: number
}

export type StreamingStatus =
  | 'idle'
  | 'streaming'
  | 'complete'
  | 'interrupted'
  | 'error'

// Embedded stream tool-call entry persisted on a message so the tool-call
// pills survive in history. Read defensively (every consumer narrows each
// field), so the element type is intentionally permissive.
export type StreamToolCallEntry = {
  id?: string
  name?: string
  phase?: string
  args?: unknown
  preview?: string
  result?: string
}

export type ChatMessage = {
  role?: string
  content?: Array<MessageContent>
  attachments?: Array<ChatAttachment>
  toolCallId?: string
  toolName?: string
  details?: Record<string, unknown>
  isError?: boolean
  timestamp?: number
  [key: string]: unknown
  // Identity / dedup fields (server- or client-assigned, all optional).
  id?: string
  messageId?: string
  clientId?: string
  client_id?: string
  nonce?: string
  // Alternate timestamp fields seen across transports; may be string or number.
  createdAt?: string | number
  created_at?: string | number
  time?: string | number
  ts?: string | number
  // Embedded stream tool calls (underscore + legacy non-underscore variant).
  __streamToolCalls?: Array<StreamToolCallEntry>
  streamToolCalls?: Array<StreamToolCallEntry>
  inlineImages?: Array<unknown>
  // Display/ordering metadata attached during history processing.
  __execNotification?: Record<string, unknown>
  __isNarration?: boolean
  __historyIndex?: number
  __realtimeSequence?: number
  __receiveTime?: number
  __optimisticId?: string
  __streamingStatus?: StreamingStatus
  __streamingText?: string
  __streamingThinking?: string
}

export type SessionTitleStatus = 'idle' | 'generating' | 'ready' | 'error'
export type SessionTitleSource = 'auto' | 'manual'

export type SessionSummary = {
  key?: string
  label?: string
  title?: string
  derivedTitle?: string
  updatedAt?: number
  lastMessage?: ChatMessage | null
  friendlyId?: string
  titleStatus?: SessionTitleStatus
  titleSource?: SessionTitleSource
  titleError?: string | null
  preview?: string | null
}

export type SessionListResponse = {
  sessions?: Array<SessionSummary>
}

export type HistoryResponse = {
  sessionKey: string
  sessionId?: string
  messages: Array<ChatMessage>
}

export type SessionMeta = {
  key: string
  friendlyId: string
  title?: string
  derivedTitle?: string
  label?: string
  updatedAt?: number
  lastMessage?: ChatMessage | null
  titleStatus?: SessionTitleStatus
  titleSource?: SessionTitleSource
  titleError?: string | null
  preview?: string | null
}

export type PathsPayload = {
  agentId: string
  stateDir: string
  sessionsDir: string
  storePath: string
}
