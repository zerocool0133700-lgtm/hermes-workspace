export const BASE_URL =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost:4444'

export type GatewaySessionUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  tokens?: number
  cost?: number
}

export type GatewayMessagePart = {
  type?: string
  text?: string
}

export type GatewaySessionMessage = {
  role?: string
  content?: Array<GatewayMessagePart>
  text?: string
}

export type GatewaySession = {
  key?: string
  friendlyId?: string
  kind?: string
  status?: string
  model?: string
  label?: string
  title?: string
  derivedTitle?: string
  task?: string
  initialMessage?: string
  progress?: number
  tokenCount?: number
  totalTokens?: number
  cost?: number
  createdAt?: number | string
  startedAt?: number | string
  updatedAt?: number | string
  lastMessage?: GatewaySessionMessage | null
  usage?: GatewaySessionUsage
  [key: string]: unknown
}

export type GatewaySessionsResponse = {
  sessions?: Array<GatewaySession>
}

export type GatewaySessionStatusResponse = {
  status?: string
  progress?: number
  model?: string
  tokenCount?: number
  totalTokens?: number
  usage?: GatewaySessionUsage
  error?: string
  [key: string]: unknown
}

export type GatewayModelCatalogEntry =
  | string
  | {
      alias?: string
      provider?: string
      model?: string
      name?: string
      label?: string
      displayName?: string
      id?: string
      [key: string]: unknown
    }

export type GatewayModelsResponse = {
  ok?: boolean
  models?: Array<GatewayModelCatalogEntry>
  configuredProviders?: Array<string>
  error?: string
}

export type GatewayModelSwitchResponse = {
  ok?: boolean
  error?: string
  resolved?: {
    modelProvider?: string
    model?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type GatewayModelDefaultResponse = {
  ok?: boolean
  error?: string
}

export type GatewayAgentActionResponse = {
  ok?: boolean
  error?: string
}

export type GatewayAgentPauseResponse = GatewayAgentActionResponse & {
  paused?: boolean
}

// ── Request timeouts (ms) ─────────────────────────────────────────────────────

const TIMEOUT = {
  approvals: 6000,
  models: 7000,
  resolveApproval: 8000,
  mutation: 12000,
  history: 15000,
  send: 30000,
} as const

const JSON_HEADERS = { 'content-type': 'application/json' } as const

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as Record<string, unknown>
    if (typeof payload.error === 'string') return payload.error
    if (typeof payload.message === 'string') return payload.message
    return JSON.stringify(payload)
  } catch {
    const text = await response.text().catch(() => '')
    return text || response.statusText || 'Gateway request failed'
  }
}

function makeEndpoint(pathname: string): string {
  return new URL(pathname, BASE_URL).toString()
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

type GatewayRequestInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs: number
}

/**
 * Performs a fetch wrapped in an AbortController-backed timeout. The returned
 * Response is left unconsumed so callers retain their bespoke parsing/guards.
 * Abort errors are rethrown unchanged so each caller can map them to its own
 * message (e.g. "Request timed out" vs "Gateway disconnected").
 */
async function gatewayFetch(
  path: string,
  init: GatewayRequestInit,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    init.timeoutMs,
  )
  try {
    return await fetch(makeEndpoint(path), {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    })
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

/**
 * Throw-mode POST helper: serializes `body`, parses the JSON response
 * defensively, and throws an Error (using the server's error, then statusText,
 * then `fallbackMessage`) when the response is non-OK or reports `ok: false`.
 * An aborted request throws `Error('Request timed out')`.
 */
async function gatewayMutate<T extends { ok?: boolean; error?: string }>(
  path: string,
  body: unknown,
  timeoutMs: number,
  fallbackMessage: string,
): Promise<T> {
  try {
    const response = await gatewayFetch(path, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      timeoutMs,
    })

    const payload = (await response.json().catch(() => ({}))) as T

    if (!response.ok || payload.ok === false) {
      const message =
        typeof payload.error === 'string' && payload.error.trim().length > 0
          ? payload.error
          : response.statusText || fallbackMessage
      throw new Error(message)
    }

    return payload
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Request timed out')
    }
    throw error
  }
}

// ── Session History & Messaging ───────────────────────────────────────────────

export type SessionHistoryMessage = {
  role: string
  content?: string | Array<{ type?: string; text?: string }>
  timestamp?: number
  toolName?: string
  toolCallId?: string
}

export type SessionHistoryResponse = {
  ok?: boolean
  messages?: Array<SessionHistoryMessage>
  error?: string
}

export async function fetchSessionHistory(
  sessionKey: string,
  opts?: { limit?: number; includeTools?: boolean },
): Promise<SessionHistoryResponse> {
  try {
    const params = new URLSearchParams({ key: sessionKey })
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.includeTools) params.set('includeTools', 'true')
    const response = await gatewayFetch(`/api/session-history?${params}`, {
      timeoutMs: TIMEOUT.history,
    })
    if (!response.ok)
      return { ok: false, messages: [], error: await readError(response) }
    return (await response.json()) as SessionHistoryResponse
  } catch (error) {
    if (isAbortError(error))
      return { ok: false, messages: [], error: 'Request timed out' }
    return { ok: false, messages: [], error: String(error) }
  }
}

export type SendToSessionResponse = {
  ok?: boolean
  error?: string
}

export async function sendToSession(
  sessionKey: string,
  message: string,
): Promise<SendToSessionResponse> {
  return gatewayMutate<SendToSessionResponse>(
    '/api/session-send',
    { sessionKey, message },
    TIMEOUT.send,
    'Failed to send message',
  )
}

export async function fetchSessions(): Promise<GatewaySessionsResponse> {
  const response = await fetch(makeEndpoint('/api/sessions'), {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(await readError(response))
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      'Session API returned non-JSON content. Your auth/proxy may have intercepted /api/sessions.',
    )
  }

  const payload = (await response.json()) as GatewaySessionsResponse
  if (!Array.isArray(payload.sessions)) {
    throw new Error('Session API returned an unexpected response shape')
  }
  return payload
}

export async function fetchSessionStatus(
  key: string,
): Promise<GatewaySessionStatusResponse> {
  const response = await fetch(
    makeEndpoint(`/api/session-status?key=${encodeURIComponent(key)}`),
  )
  if (!response.ok) {
    throw new Error(await readError(response))
  }

  const payload: unknown = await response.json()
  const normalized =
    payload !== null &&
    typeof payload === 'object' &&
    'payload' in payload &&
    (payload as Record<string, unknown>).payload !== null &&
    typeof (payload as Record<string, unknown>).payload === 'object'
      ? (payload as Record<string, unknown>).payload
      : payload

  return normalized as GatewaySessionStatusResponse
}

export async function fetchModels(): Promise<GatewayModelsResponse> {
  try {
    const response = await gatewayFetch('/api/models', {
      timeoutMs: TIMEOUT.models,
    })
    if (!response.ok) {
      throw new Error(await readError(response))
    }

    const payload = (await response.json()) as GatewayModelsResponse
    if (payload.ok === false) {
      throw new Error(payload.error || 'Failed to load models')
    }

    return {
      ok: true,
      models: Array.isArray(payload.models) ? payload.models : [],
      configuredProviders: Array.isArray(payload.configuredProviders)
        ? payload.configuredProviders
        : [],
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Gateway disconnected')
    }
    throw error
  }
}

export async function switchModel(
  model: string,
  sessionKey?: string,
): Promise<GatewayModelSwitchResponse> {
  return gatewayMutate<GatewayModelSwitchResponse>(
    '/api/model-switch',
    { model, sessionKey },
    TIMEOUT.mutation,
    'Failed to switch model',
  )
}

export async function setDefaultModel(
  model: string,
): Promise<GatewayModelDefaultResponse> {
  return gatewayMutate<GatewayModelDefaultResponse>(
    '/api/config-patch',
    {
      raw: JSON.stringify({ defaultModel: model }, null, 2),
      reason: 'Studio: set default model',
    },
    TIMEOUT.mutation,
    'Failed to persist default model',
  )
}

export async function steerAgent(
  sessionKey: string,
  message: string,
): Promise<GatewayAgentActionResponse> {
  return gatewayMutate<GatewayAgentActionResponse>(
    '/api/agent-steer',
    { sessionKey, message },
    TIMEOUT.mutation,
    'Failed to send directive',
  )
}

export async function killAgentSession(
  sessionKey: string,
): Promise<GatewayAgentActionResponse> {
  return gatewayMutate<GatewayAgentActionResponse>(
    '/api/agent-kill',
    { sessionKey },
    TIMEOUT.mutation,
    'Failed to terminate agent',
  )
}

// ── Gateway Approvals ─────────────────────────────────────────────────────────

export type GatewayApprovalEntry = {
  id: string
  sessionKey?: string
  agentName?: string
  action?: string
  context?: string
  tool?: string
  input?: unknown
  requestedAt?: number
  status?: 'pending' | 'approved' | 'denied'
}

export type GatewayApprovalsResponse = {
  ok?: boolean
  approvals?: Array<GatewayApprovalEntry>
  pending?: Array<GatewayApprovalEntry>
}

export async function fetchGatewayApprovals(): Promise<GatewayApprovalsResponse> {
  try {
    const response = await gatewayFetch('/api/gateway/approvals', {
      timeoutMs: TIMEOUT.approvals,
    })
    if (!response.ok) return { ok: false, approvals: [] }
    return (await response.json()) as GatewayApprovalsResponse
  } catch {
    return { ok: false, approvals: [] }
  }
}

export async function resolveGatewayApproval(
  approvalId: string,
  action: 'approve' | 'deny',
): Promise<{ ok: boolean }> {
  try {
    const response = await gatewayFetch(
      `/api/gateway/approvals/${approvalId}/${action}`,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        timeoutMs: TIMEOUT.resolveApproval,
      },
    )
    return { ok: response.ok }
  } catch {
    return { ok: false }
  }
}

export async function toggleAgentPause(
  sessionKey: string,
  pause: boolean,
): Promise<GatewayAgentPauseResponse> {
  return gatewayMutate<GatewayAgentPauseResponse>(
    '/api/agent-pause',
    { sessionKey, pause },
    TIMEOUT.mutation,
    'Failed to update pause state',
  )
}
