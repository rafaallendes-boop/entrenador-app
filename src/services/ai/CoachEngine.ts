/**
 * CoachEngine - orchestrates all AI coach interactions.
 */

import type { AIProvider, AIRequest, CoachNormalizedResponse } from './types'
import type { AIRequestClass, AITechnicalSurface, ChatContext } from '../../types'
import { buildCoachPrompt } from './promptBuilder'
import { normalizeResponse } from './responseNormalizer'
import { AIProviderError, createProviderError } from './types'
import { buildAITraceId, getAIRequestPolicy } from './requestPolicy'
import { getActiveProvider, isRealProviderConfigured } from './providerResolver'
import { useAIDebugStore } from '../../store/useAIDebugStore'

export type CoachActionIntent = 'create_full_plan' | 'modify_plan' | 'none'
type CoachSendOptions = {
  maxTokens?: number
  temperature?: number
  onChunk?: (chunk: string) => void
  surface?: AITechnicalSurface
}
type CoachDispatcherOptions = CoachSendOptions & {
  requestClass?: AIRequestClass
}

export const CoachEngine = {
  async sendChat(
    userMessage: string,
    context: ChatContext,
    options?: CoachSendOptions,
  ): Promise<CoachNormalizedResponse> {
    return sendTrackedCoachRequest(userMessage, context, 'chat_general', 'none', options)
  },

  async sendAction(
    userMessage: string,
    context: ChatContext,
    options?: CoachSendOptions,
  ): Promise<CoachNormalizedResponse> {
    const actionIntent = resolveActionIntent(userMessage, context)
    return sendTrackedCoachRequest(userMessage, context, 'chat_action', actionIntent, options)
  },

  async send(
    userMessage: string,
    context: ChatContext,
    options?: CoachDispatcherOptions,
  ): Promise<CoachNormalizedResponse> {
    if (options?.requestClass === 'weekly_summary') {
      return sendTrackedCoachRequest(userMessage, context, 'weekly_summary', 'none', options)
    }

    if (options?.requestClass === 'chat_general') {
      return this.sendChat(userMessage, context, options)
    }

    if (options?.requestClass === 'chat_action') {
      return this.sendAction(userMessage, context, options)
    }

    const actionIntent = inferCoachActionIntent(userMessage)
    if (actionIntent === 'none') {
      return this.sendChat(userMessage, context, options)
    }

    return this.sendAction(userMessage, context, options)
  },

  async extractRaw(
    systemPrompt: string,
    userMessage: string,
    options?: {
      maxTokens?: number
      temperature?: number
      requestClass?: AIRequestClass
      surface?: AITechnicalSurface
      conversation?: AIRequest['conversation']
    },
  ): Promise<string> {
    const provider = getActiveProvider()
    const requestClass = options?.requestClass ?? 'import_extract'
    const policy = getAIRequestPolicy(requestClass)
    const traceId = buildAITraceId(requestClass)
    const surface = options?.surface ?? 'import'
    useAIDebugStore.getState().startRequest({
      traceId,
      requestClass,
      surface,
      startedAt: Date.now(),
    })

    try {
      const raw = await provider.call({
        requestClass,
        traceId,
        allowFallback: policy.allowFallback,
        conversation: options?.conversation,
        systemPrompt,
        userMessage,
        maxTokens: options?.maxTokens ?? policy.maxTokens,
        temperature: options?.temperature ?? policy.temperature,
      })
      useAIDebugStore.getState().completeRequest(traceId, {
        provider: raw.provider,
        model: raw.model,
        durationMs: raw.durationMs,
        retryUsed: raw.retryUsed,
        fallbackUsed: raw.fallbackUsed,
      })
      return raw.text
    } catch (error) {
      useAIDebugStore.getState().failRequest(traceId, {
        errorCode: error instanceof AIProviderError ? error.code : 'unknown',
      })
      throw error
    }
  },

  getProviderName(): string {
    return getActiveProvider().name
  },

  isRealProviderConfigured(): boolean {
    return isRealProviderConfigured()
  },
}

async function sendTrackedCoachRequest(
  userMessage: string,
  context: ChatContext,
  requestClass: AIRequestClass,
  actionIntent: CoachActionIntent,
  options?: CoachSendOptions,
): Promise<CoachNormalizedResponse> {
  const provider = getActiveProvider()
  const policy = getAIRequestPolicy(requestClass)
  const surface = options?.surface ?? 'chat'

  return withTracing(requestClass, surface, async (traceId) => {
    let firstChunkSeen = false
    const prompt = buildCoachPrompt(context, { requestClass, userMessage })

    if (prompt.trace) {
      useAIDebugStore.getState().updateRequest(traceId, {
        promptTrace: prompt.trace,
      })
    }

    const request: AIRequest = {
      systemPrompt: prompt.systemPrompt,
      userMessage,
      requestClass,
      traceId,
      conversation: (context.recentMessages ?? []).map(message => ({
        role: message.role === 'coach' ? 'assistant' : 'user',
        content: message.content,
      })),
      maxTokens: options?.maxTokens ?? policy.maxTokens,
      temperature: options?.temperature ?? policy.temperature,
      allowFallback: policy.allowFallback,
      onChunk: options?.onChunk
        ? (chunk) => {
            if (!firstChunkSeen) {
              firstChunkSeen = true
              useAIDebugStore.getState().markFirstChunk(traceId)
            }
            options.onChunk?.(chunk)
          }
        : undefined,
    }

    return requestClass === 'chat_action'
      ? sendWithRecovery(provider, request, actionIntent)
      : sendDirect(provider, request)
  })
}

async function withTracing<T extends Pick<CoachNormalizedResponse, 'provider' | 'model' | 'durationMs' | 'retryUsed' | 'fallbackUsed'>>(
  requestClass: AIRequestClass,
  surface: AITechnicalSurface,
  run: (traceId: string) => Promise<T>,
): Promise<T> {
  const traceId = buildAITraceId(requestClass)
  useAIDebugStore.getState().startRequest({
    traceId,
    requestClass,
    surface,
    startedAt: Date.now(),
  })

  try {
    const result = await run(traceId)
    useAIDebugStore.getState().completeRequest(traceId, {
      provider: result.provider,
      model: result.model,
      durationMs: result.durationMs,
      retryUsed: result.retryUsed,
      fallbackUsed: result.fallbackUsed,
    })
    return result
  } catch (error) {
    useAIDebugStore.getState().failRequest(traceId, {
      errorCode: error instanceof AIProviderError ? error.code : 'unknown',
    })
    throw error
  }
}

function resolveActionIntent(userMessage: string, context: ChatContext): CoachActionIntent {
  const inferred = inferCoachActionIntent(userMessage)
  if (inferred !== 'none') return inferred
  if (context.intent === 'adjust_session') return 'modify_plan'
  if (context.intent === 'plan_week') return 'create_full_plan'
  return 'modify_plan'
}

/** Nivel 1 — direct call without format retry (chat_general). */
async function sendDirect(
  provider: AIProvider,
  request: AIRequest,
): Promise<CoachNormalizedResponse> {
  const raw = await provider.call(request)
  return normalizeResponse(raw)
}

/** Nivel 2 — call with action format retry (chat_action). */
async function sendWithRecovery(
  provider: AIProvider,
  request: AIRequest,
  actionIntent: CoachActionIntent,
): Promise<CoachNormalizedResponse> {
  const firstRaw = await provider.call(request)
  const firstNormalized = normalizeResponse(firstRaw)

  if (!shouldRetry(firstNormalized, actionIntent)) {
    return firstNormalized
  }

  const retryRaw = await provider.call({
    ...request,
    systemPrompt: `${request.systemPrompt}

IMPORTANTE DE FORMATO:
- Si el usuario pidio crear o modificar un plan, DEBES incluir un bloque <actions> valido.
- Si usas <actions>, cierra siempre con </actions>.
- El contenido dentro de <actions> debe ser JSON valido.
- Para create_week, prioriza una semana compacta y ejecutable.
- No incluyas warmup/cooldown salvo que aporte valor claro: el sistema completa protocolos base automaticamente si faltan.
- Si tu respuesta anterior fue solo texto, ahora corrige eso y devuelve acciones reales.`,
    temperature: Math.min(request.temperature ?? 0.7, 0.3),
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

export function inferCoachActionIntent(userMessage: string): CoachActionIntent {
  const normalized = userMessage.trim().toLowerCase()
  const weekDayPattern = /\b(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|hoy|mañana|manana)\b/
  const modificationVerbPattern = /\b(ajusta(?:r)?|reordena(?:r)?|mueve|cambia|agrega|quita|sube|baja|reduce|simplifica|reemplaza|incorpora)\b/
  if (!normalized) return 'none'

  if (
    /\b(plan\s+completo|todas\s+las\s+semanas|plan\s+hasta|semanas\s+hasta|completo\s+hasta|completo\s+para\s+\d+\s+semanas)\b/.test(normalized) ||
    (/\b(plan|cr[eé]a(?:r|me)?)\b/.test(normalized) && /\buna\s+acción\s+create_week\s+por\s+semana\b/.test(normalized))
  ) {
    return 'create_full_plan'
  }

  if (
    modificationVerbPattern.test(normalized) &&
    (
      /\b(semana|sesion|sesión|plan|carga|running|squash|fuerza|cycling|ciclismo|movilidad)\b/.test(normalized)
      || weekDayPattern.test(normalized)
    )
  ) {
    return 'modify_plan'
  }

  return 'none'
}

export function shouldRetry(response: CoachNormalizedResponse, actionIntent: CoachActionIntent): boolean {
  if (response.meta?.actionParseFailed || response.meta?.likelyTruncated) return true
  if (actionIntent !== 'none' && (!response.actions || response.actions.length === 0)) return true
  return false
}

function shouldRejectAfterRetry(response: CoachNormalizedResponse): boolean {
  // Solo rechazar cuando el JSON está genuinamente malformado.
  // Si el modelo simplemente no incluyó acciones, devolvemos el texto para que el usuario pueda continuar.
  return response.meta?.actionParseFailed === true
}
