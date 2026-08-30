import { estimateCostUsd } from '../../../src/services/planBuilder/pricing'

/**
 * Modelo que registra el bypass determinista. No corresponde a ninguna
 * llamada a proveedor: su costo real es cero, no desconocido.
 */
export const DETERMINISTIC_BYPASS_MODEL = 'local_regex (deterministic_bypass)'

export type CoachRequestClass =
  | 'chat_general'
  | 'chat_action'
  | 'weekly_summary'
  | 'week_creator'
  | 'plan_builder_week'
  | 'plan_builder_pair'
  | 'import_extract'
  | 'coach_assistant_message'

export interface CoachRequestTelemetry {
  traceId: string
  userId: string
  generationId?: string
  logicalAttempt?: number
  requestClass: CoachRequestClass
  /** Transporte efectivo, no el solicitado. Ver spec §4.0. */
  streamed: boolean
  /** `safety_blocked` is a completed post-processing decline, never an error. */
  outcome: 'ok' | 'error' | 'safety_blocked'
  errorCode?: string
  finishReason?: string
  retryUsed?: boolean
  fallbackUsed?: boolean
  authDurationMs: number
  providerDurationMs?: number
  serverDurationMs: number
  provider?: string
  model?: string
  serviceTier?: string
  reasoningEffort?: string
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  responseCharCount?: number
  createdAt: number
}

/**
 * Tres estados, no dos (spec §5.1):
 *   0    -> bypass determinista: costo conocido y cero
 *   null -> precio no disponible o usage insuficiente
 *   n    -> costo estimado con la tabla fechada
 */
export function resolveCoachRequestCostUsd(telemetry: CoachRequestTelemetry): number | null {
  if (telemetry.model === DETERMINISTIC_BYPASS_MODEL) return 0
  if (!telemetry.model) return null

  const { promptTokens, completionTokens } = telemetry
  if (typeof promptTokens !== 'number' || typeof completionTokens !== 'number') return null

  return estimateCostUsd({
    model: telemetry.model,
    at: telemetry.createdAt,
    // El tier ya viajaba en la telemetría y no se estaba usando: sin él,
    // `week_creator` en `priority` se tarifaba al precio estándar, ~75% por
    // debajo de lo que realmente cuesta.
    serviceTier: telemetry.serviceTier,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    cacheReadTokens: telemetry.cacheReadInputTokens ?? 0,
    cacheCreationTokens: telemetry.cacheCreationInputTokens ?? 0,
  })
}

function orNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value
}

export function coachRequestToRow(telemetry: CoachRequestTelemetry): Record<string, unknown> {
  return {
    trace_id: telemetry.traceId,
    user_id: telemetry.userId,
    generation_id: orNull(telemetry.generationId),
    logical_attempt: orNull(telemetry.logicalAttempt),
    request_class: telemetry.requestClass,
    streamed: telemetry.streamed,
    outcome: telemetry.outcome,
    error_code: orNull(telemetry.errorCode),
    finish_reason: orNull(telemetry.finishReason),
    retry_used: orNull(telemetry.retryUsed),
    fallback_used: orNull(telemetry.fallbackUsed),
    auth_duration_ms: telemetry.authDurationMs,
    provider_duration_ms: orNull(telemetry.providerDurationMs),
    server_duration_ms: telemetry.serverDurationMs,
    provider: orNull(telemetry.provider),
    model: orNull(telemetry.model),
    service_tier: orNull(telemetry.serviceTier),
    reasoning_effort: orNull(telemetry.reasoningEffort),
    prompt_tokens: orNull(telemetry.promptTokens),
    completion_tokens: orNull(telemetry.completionTokens),
    reasoning_tokens: orNull(telemetry.reasoningTokens),
    cache_creation_input_tokens: orNull(telemetry.cacheCreationInputTokens),
    cache_read_input_tokens: orNull(telemetry.cacheReadInputTokens),
    response_char_count: orNull(telemetry.responseCharCount),
    estimated_cost_usd: resolveCoachRequestCostUsd(telemetry),
    created_at: new Date(telemetry.createdAt).toISOString(),
  }
}

/**
 * Plazo del insert. El corte es el AbortSignal, no un race: `withTimeout`
 * deja de esperar pero no cancela el fetch, y un fetch vivo sigue ocupando el
 * event loop.
 */
export const COACH_REQUEST_INSERT_TIMEOUT_MS = 3_000

export interface CoachRequestInsertClient {
  from(table: string): {
    insert(row: Record<string, unknown>): {
      abortSignal(signal: AbortSignal): PromiseLike<{ error: unknown }>
    }
  }
}

/**
 * Best-effort: nunca lanza ni altera el camino caliente. No distingue formas
 * de error: supabase-js puede devolver un error o lanzar una excepción.
 */
export async function insertCoachRequestRow(
  client: CoachRequestInsertClient,
  telemetry: CoachRequestTelemetry,
): Promise<'ok' | 'failed'> {
  try {
    const { error } = await client
      .from('coach_requests')
      .insert(coachRequestToRow(telemetry))
      .abortSignal(AbortSignal.timeout(COACH_REQUEST_INSERT_TIMEOUT_MS))
    return error ? 'failed' : 'ok'
  } catch {
    return 'failed'
  }
}
