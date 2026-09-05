import { CoachEngine } from '../ai/CoachEngine'
import { AIProviderError } from '../ai/types'
import { CoachAccessRequiredError } from '../entitlements/coachAccessError'
import { EntitlementRequiredError } from '../entitlements/entitlementError'
import {
  KillSwitchActiveError,
  QuotaExceededError,
  SpendCapExceededError,
} from '../entitlements/usageGateError'
import type { TriageSignal } from '../athlete/coachRosterTriage'
import {
  ASSISTANT_MESSAGE_SCHEMA,
  ASSISTANT_SYSTEM_PROMPT,
  buildAssistantMessageInput,
  parseAssistantMessageResult,
} from './assistantMessage'

export type DraftFailure =
  | 'quota'
  | 'kill-switch'
  | 'entitlement'
  | 'coach-access'
  | 'timeout'
  | 'network'
  | 'rate-limit'
  | 'unavailable'
  | 'invalid-response'
  | 'too-long'

export type DraftResult =
  | { ok: true; body: string }
  | { ok: false; reason: DraftFailure }

function errorName(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('name' in error)) return null
  return typeof error.name === 'string' ? error.name : null
}

function classifyDraftError(error: unknown): DraftFailure {
  // SpendCap no tiene una categoría propia en la UI: al igual que la cuota,
  // es un rechazo definitivo del gate y pulsar otra vez no puede resolverlo.
  if (
    error instanceof QuotaExceededError
    || error instanceof SpendCapExceededError
    || (error instanceof AIProviderError
      && (
        error.code === 'quota_exceeded'
        || error.code === 'spend_cap_exceeded'
        // El preflight local de aiTelemetry usa rate_limit no reintentable
        // cuando el bucket diario ya se agotó. Un 429 real del proveedor es
        // reintentable y no entra en esta rama.
        || (error.code === 'rate_limit' && !error.retryable)
      ))
    || errorName(error) === 'QuotaExceededError'
    || errorName(error) === 'SpendCapExceededError'
  ) return 'quota'

  if (
    error instanceof KillSwitchActiveError
    || (error instanceof AIProviderError && error.code === 'kill_switch_active')
    || errorName(error) === 'KillSwitchActiveError'
  ) return 'kill-switch'

  // Antes que `entitlement`: rol/membresía no se resuelven con un plan y la
  // UI no debe ofrecer una compra que no destraba nada.
  if (
    error instanceof CoachAccessRequiredError
    || (error instanceof AIProviderError && error.code === 'coach_access_required')
    || errorName(error) === 'CoachAccessRequiredError'
  ) return 'coach-access'

  if (
    error instanceof EntitlementRequiredError
    || (error instanceof AIProviderError && error.code === 'entitlement_required')
    || errorName(error) === 'EntitlementRequiredError'
  ) return 'entitlement'

  if (
    errorName(error) === 'AbortError'
    || (error instanceof AIProviderError && error.code === 'timeout')
  ) return 'timeout'

  if (error instanceof AIProviderError && error.code === 'parse_error') {
    return 'invalid-response'
  }

  if (
    error instanceof AIProviderError
    && error.code === 'rate_limit'
    && error.retryable
  ) return 'rate-limit'

  if (error instanceof AIProviderError && !error.retryable) return 'unavailable'

  return 'network'
}

/**
 * `athleteId` es el único objetivo explícito del producto: el coach le escribe
 * a un alumno concreto de la tarjeta, no al atleta del scope activo.
 */
export async function requestAssistantDraft(
  athleteId: string,
  signals: TriageSignal[],
): Promise<DraftResult> {
  // Fail closed: sin una señal factual el modelo tendría que inventar el
  // motivo del contacto y además gastaría cuota sin aportar valor.
  if (signals.length === 0) return { ok: false, reason: 'invalid-response' }

  const input = buildAssistantMessageInput(signals)

  try {
    let parsedResult: ReturnType<typeof parseAssistantMessageResult> | undefined
    const raw = await CoachEngine.extractRaw(
      ASSISTANT_SYSTEM_PROMPT,
      JSON.stringify(input),
      {
        requestClass: 'coach_assistant_message',
        surface: 'coach_assistant',
        targetAthleteId: athleteId,
        responseMimeType: 'application/json',
        responseSchema: ASSISTANT_MESSAGE_SCHEMA,
        classifyResponse: (text) => {
          parsedResult = parseAssistantMessageResult(text)
          if (parsedResult.ok) return { outcome: 'ok' }
          if (parsedResult.reason === 'invalid-json') {
            return { outcome: 'parse_invalid', errorCode: 'assistant_invalid_json' }
          }
          return {
            outcome: 'schema_invalid',
            errorCode: `assistant_${parsedResult.reason.replaceAll('-', '_')}`,
          }
        },
      },
    )
    const parsed = parsedResult ?? parseAssistantMessageResult(raw)
    if (parsed.ok) return { ok: true, body: parsed.body }
    return {
      ok: false,
      reason: parsed.reason === 'too-long' ? 'too-long' : 'invalid-response',
    }
  } catch (error) {
    return { ok: false, reason: classifyDraftError(error) }
  }
}
