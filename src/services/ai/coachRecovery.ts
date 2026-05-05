/**
 * coachRecovery — retry logic for chat_action requests.
 *
 * Extracted from CoachEngine to keep the engine file focused on orchestration.
 * Only used when requestClass === 'chat_action'.
 */

import type { AIProvider, AIRequest, CoachNormalizedResponse } from './types'
import { AIProviderError, createProviderError } from './types'
import { normalizeResponse } from './responseNormalizer'

const ACTION_FORMAT_RETRY_INSTRUCTION = `
IMPORTANTE DE FORMATO:
- Si el usuario pidio crear o modificar un plan, DEBES incluir un bloque <actions> valido.
- Si usas <actions>, cierra siempre con </actions>.
- El contenido dentro de <actions> debe ser JSON valido.
- Para create_week, prioriza una semana compacta y ejecutable.
- No incluyas warmup/cooldown salvo que aporte valor claro: el sistema completa protocolos base automaticamente si faltan.
- Si tu respuesta anterior fue solo texto, ahora corrige eso y devuelve acciones reales.`

const RETRY_BACKOFF_MS = [300, 800] as const

/** Returns true only when the model produced genuinely malformed output. */
export function shouldRetryAction(response: CoachNormalizedResponse): boolean {
  return response.meta?.actionParseFailed === true || response.meta?.likelyTruncated === true
}

function shouldRejectAfterRetry(response: CoachNormalizedResponse): boolean {
  // Only reject when JSON is genuinely malformed.
  // If the model simply omitted actions, return the text so the user can continue.
  return response.meta?.actionParseFailed === true
}

/** Retryable transient provider errors at the client layer (in addition to server retries). */
function isRetryableProviderError(error: unknown): boolean {
  if (!(error instanceof AIProviderError)) return false
  return error.code === 'timeout' || error.code === 'rate_limit' || error.code === 'server_error'
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return
  await new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(id)
      resolve()
    }, { once: true })
  })
}

/** Nivel 2 — call with action format retry (chat_action). */
export async function sendWithRecovery(
  provider: AIProvider,
  request: AIRequest,
): Promise<CoachNormalizedResponse> {
  // First call with one transient retry on timeout/rate_limit/server_error.
  const firstNormalized = await callWithTransientRetry(provider, request)

  if (!shouldRetryAction(firstNormalized)) {
    return firstNormalized
  }

  // Format-fix retry: stronger instruction + lower temperature.
  const retryRaw = await provider.call({
    ...request,
    systemPrompt: `${request.systemPrompt}${ACTION_FORMAT_RETRY_INSTRUCTION}`,
    temperature: Math.min(request.temperature ?? 0.7, 0.3),
    signal: request.signal,
    onChunk: undefined,
  })
  const retryNormalized = normalizeResponse(retryRaw)

  if (shouldRejectAfterRetry(retryNormalized)) {
    throw createProviderError(
      provider.name,
      'parse_error',
      'El coach devolvio una respuesta con formato invalido en el bloque de acciones. Intenta de nuevo.',
      true,
    )
  }

  return {
    ...retryNormalized,
    retryUsed: true,
    fallbackUsed: retryNormalized.fallbackUsed || firstNormalized.fallbackUsed,
    meta: {
      hadActionsMarkup: retryNormalized.meta?.hadActionsMarkup ?? false,
      actionParseFailed: retryNormalized.meta?.actionParseFailed ?? false,
      likelyTruncated: retryNormalized.meta?.likelyTruncated ?? false,
      invalidActionCount: retryNormalized.meta?.invalidActionCount,
      createWeekDiagnostics: retryNormalized.meta?.createWeekDiagnostics,
      outcome: retryNormalized.meta?.outcome,
      errorClass: retryNormalized.meta?.errorClass,
    },
  }
}

/**
 * Call provider, retrying once with backoff on transient errors. Counts as one
 * client-side retry on top of the netlify proxy's own retry/fallback policy.
 */
async function callWithTransientRetry(
  provider: AIProvider,
  request: AIRequest,
): Promise<CoachNormalizedResponse> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    try {
      const raw = await provider.call(request)
      return normalizeResponse(raw)
    } catch (error) {
      lastError = error
      if (!isRetryableProviderError(error) || attempt === RETRY_BACKOFF_MS.length) {
        throw error
      }
      await delay(RETRY_BACKOFF_MS[attempt], request.signal)
      if (request.signal?.aborted) throw error
    }
  }
  // Unreachable, but TS needs it.
  throw lastError
}
