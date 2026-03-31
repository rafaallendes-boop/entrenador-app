/**
 * Core types for the AI abstraction layer.
 *
 * All providers (Claude, OpenAI, Mock) share these contracts.
 * The app only depends on these types — never on provider-specific shapes.
 */

import type { CoachAction, ChatContext, AIProviderName } from '../../types'

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
  maxTokens?: number
  temperature?: number
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
  /** ID of the CoachProposal created from actions, if any */
  proposalId?: string
  meta?: {
    hadActionsMarkup: boolean
    actionParseFailed: boolean
    likelyTruncated: boolean
    retryUsed?: boolean
  }
}

// ─── Provider errors ───────────────────────────────────────────────────────────

export type AIErrorCode =
  | 'unauthorized'   // bad or missing API key
  | 'rate_limit'     // 429 from provider
  | 'timeout'        // fetch timeout
  | 'parse_error'    // response could not be parsed
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
