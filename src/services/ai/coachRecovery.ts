/**
 * coachRecovery — retry logic for chat_action requests.
 *
 * Extracted from CoachEngine to keep the engine file focused on orchestration.
 * Only used when requestClass === 'chat_action'.
 */

import type { AIProvider, AIRequest, CoachNormalizedResponse } from './types'
import { createProviderError } from './types'
import { normalizeResponse } from './responseNormalizer'

const ACTION_FORMAT_RETRY_INSTRUCTION = `
IMPORTANTE DE FORMATO:
- Si el usuario pidio crear o modificar un plan, DEBES incluir un bloque <actions> valido.
- Si usas <actions>, cierra siempre con </actions>.
- El contenido dentro de <actions> debe ser JSON valido.
- Para create_week, prioriza una semana compacta y ejecutable.
- No incluyas warmup/cooldown salvo que aporte valor claro: el sistema completa protocolos base automaticamente si faltan.
- Si tu respuesta anterior fue solo texto, ahora corrige eso y devuelve acciones reales.`

/** Returns true only when the model produced genuinely malformed output. */
export function shouldRetryAction(response: CoachNormalizedResponse): boolean {
  return response.meta?.actionParseFailed === true || response.meta?.likelyTruncated === true
}

function shouldRejectAfterRetry(response: CoachNormalizedResponse): boolean {
  // Only reject when JSON is genuinely malformed.
  // If the model simply omitted actions, return the text so the user can continue.
  return response.meta?.actionParseFailed === true
}

/** Nivel 2 — call with action format retry (chat_action). */
export async function sendWithRecovery(
  provider: AIProvider,
  request: AIRequest,
): Promise<CoachNormalizedResponse> {
  const firstRaw = await provider.call(request)
  const firstNormalized = normalizeResponse(firstRaw)

  if (!shouldRetryAction(firstNormalized)) {
    return firstNormalized
  }

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
    },
  }
}
