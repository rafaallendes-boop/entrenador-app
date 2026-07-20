/**
 * Core types for the AI abstraction layer.
 *
 * All providers (Claude, OpenAI, Mock) share these contracts.
 * The app only depends on these types — never on provider-specific shapes.
 */

import type { CoachAction, ChatContext, AIProviderName, AIRequestClass } from '../../types'

// ─── Provider identity re-export ───────────────────────────────────────────────
// Defined in src/types/index.ts — re-exported here for convenience.

export type { AIProviderName }

// ─── Provider interface ────────────────────────────────────────────────────────

/**
 * What every AI provider must implement.
 * The CoachEngine calls `provider.call()` — providers handle their own HTTP/auth.
 */
export interface AIProvider {
  readonly name: AIProviderName
  call(request: AIRequest): Promise<AIRawResponse>
}

// ─── Request shape ─────────────────────────────────────────────────────────────

export interface AIRequest {
  systemPrompt: string
  userMessage: string
  conversation?: AIConversationMessage[]
  requestClass: AIRequestClass
  traceId: string
  generationId?: string
  /** Logical engine attempt; distinct from retries performed inside the proxy. */
  logicalAttempt?: number
  maxTokens?: number
  temperature?: number
  responseMimeType?: 'application/json'
  responseSchema?: Record<string, unknown>
  allowFallback?: boolean
  signal?: AbortSignal
  /** Called with each text chunk as it arrives. When provided, providers that
   *  support SSE streaming will emit chunks in real time. Providers that don't
   *  support streaming (e.g. ProxyProvider) ignore this field. */
  onChunk?: (chunk: string) => void
}

export interface AIConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

// ─── Raw response (before normalization) ──────────────────────────────────────

export interface AIRawResponse {
  text: string
  provider: AIProviderName
  model?: string
  raw?: unknown        // full API response, available for debugging
  durationMs?: number
  traceId?: string
  generationId?: string
  requestClass?: AIRequestClass
  retryUsed?: boolean
  fallbackUsed?: boolean
  /** True when the provider stream was cut mid-response due to an error. */
  truncated?: boolean
  /** Provider stop reason, e.g. MAX_TOKENS / length / max_tokens. */
  finishReason?: string
  /** Server-side error classification, if any (propagated from coach proxy). */
  errorClass?: AIErrorCode
  /** Provider-reported usage. These counts never contain prompt/response text. */
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  /** Provider tier actually used (for example OpenAI default or priority). */
  serviceTier?: string
  /** Reasoning effort requested from the effective provider model. */
  reasoningEffort?: string
  /** Total server request time, including auth and proxy overhead. */
  serverDurationMs?: number
  authDurationMs?: number
}

export interface CreateWeekNormalizationDiagnostic {
  targetDate?: string
  rawSessions: number
  validSessions: number
  droppedSessions: number
  repairedSessions?: Array<{ index: number; repairs: string[] }>
  droppedSessionReasons?: Array<{ index: number; reason: string }>
}

// ─── Normalized coach response (what the app consumes) ────────────────────────

export interface CoachNormalizedResponse {
  /** Clean text for the chat UI — actions block stripped out */
  message: string
  /** Structured actions extracted from the response, if any */
  actions?: CoachAction[]
  /** Nutrition tips extracted from structured response (future — always undefined v1) */
  nutritionFocus?: string[]
  provider: AIProviderName
  model?: string
  /** Full raw API response — useful for debugging, never shown in UI */
  raw?: unknown
  timestamp: number
  durationMs?: number
  traceId: string
  generationId?: string
  requestClass: AIRequestClass
  retryUsed?: boolean
  fallbackUsed?: boolean
  finishReason?: string
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  serviceTier?: string
  reasoningEffort?: string
  serverDurationMs?: number
  authDurationMs?: number
  /** ID of the CoachProposal created from actions, if any */
  proposalId?: string
  meta?: {
    hadActionsMarkup: boolean
    actionParseFailed: boolean
    likelyTruncated: boolean
    invalidActionCount?: number
    createWeekDiagnostics?: CreateWeekNormalizationDiagnostic[]
    /**
     * Refined classification of how the response failed (or `ok` when fine):
     * - `ok`: response parsed cleanly with usable actions / text
     * - `truncated_mid`: actions block opened, some actions parsed, was cut mid-array
     * - `truncated_early`: response was cut before any usable content
     * - `parse_invalid`: JSON syntax could not be recovered
     * - `schema_invalid`: JSON parsed but no valid action shapes
     */
    outcome?: 'ok' | 'truncated_mid' | 'truncated_early' | 'parse_invalid' | 'schema_invalid'
    /** Non-blocking normalization observations that should not trigger retry by themselves. */
    warnings?: string[]
    /** Server-side errorCode propagated through (e.g. timeout, rate_limit). */
    errorClass?: AIErrorCode
  }
}

// ─── Provider errors ───────────────────────────────────────────────────────────

export type AIErrorCode =
  | 'unauthorized'   // bad or missing API key
  | 'rate_limit'     // 429 from provider
  | 'timeout'        // fetch timeout
  | 'truncated'      // provider stopped because output token budget was exhausted
  | 'parse_error'    // response could not be parsed
  | 'misconfigured'  // server or provider config missing
  | 'server_error'   // internal proxy/backend error
  | 'unknown'        // catch-all

export class AIProviderError extends Error {
  readonly provider: AIProviderName
  readonly code: AIErrorCode
  readonly retryable: boolean

  constructor(
    provider: AIProviderName,
    code: AIErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message)
    this.name = 'AIProviderError'
    this.provider = provider
    this.code = code
    this.retryable = retryable
  }
}

export function createProviderError(
  provider: AIProviderName,
  code: AIErrorCode,
  message: string,
  retryable = false,
): AIProviderError {
  return new AIProviderError(provider, code, message, retryable)
}

// ─── Re-export ChatContext so providers/engine don't need separate import ──────

export type { ChatContext }
