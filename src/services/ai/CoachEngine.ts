/**
 * CoachEngine - orchestrates all AI coach interactions.
 */

import type { AIProvider, AIRequest, CoachNormalizedResponse } from './types'
import type { AIRequestClass, AITechnicalSurface, ChatContext } from '../../types'
import { buildCoachSystemPrompt } from './promptBuilder'
import { normalizeResponse } from './responseNormalizer'
import { AIProviderError, createProviderError } from './types'
import { ClaudeProvider } from './providers/ClaudeProvider'
import { OpenAIProvider } from './providers/OpenAIProvider'
import { MockProvider } from './providers/MockProvider'
import { GeminiProvider } from './providers/GeminiProvider'
import { ProxyProvider } from './providers/ProxyProvider'
import { buildAITraceId, getAIRequestPolicy } from './requestPolicy'
import { useAIDebugStore } from '../../store/useAIDebugStore'

export type CoachActionIntent = 'create_week' | 'create_full_plan' | 'modify_plan' | 'none'

function getConfiguredProviderName(): string {
  if (import.meta.env.PROD) {
    return 'proxy'
  }
  return (import.meta.env.VITE_AI_PROVIDER ?? 'mock').toLowerCase()
}

function getActiveProvider(): AIProvider {
  const name = getConfiguredProviderName()
  switch (name) {
    case 'proxy':
      return new ProxyProvider()
    case 'claude':
      return new ClaudeProvider()
    case 'openai':
      return new OpenAIProvider()
    case 'gemini':
      return new GeminiProvider()
    default:
      return new MockProvider()
  }
}

export const CoachEngine = {
  async send(
    userMessage: string,
    context: ChatContext,
    options?: {
      maxTokens?: number
      temperature?: number
      onChunk?: (chunk: string) => void
      requestClass?: AIRequestClass
      surface?: AITechnicalSurface
    },
  ): Promise<CoachNormalizedResponse> {
    const provider = getActiveProvider()
    const actionIntent = inferCoachActionIntent(userMessage)
    const requestClass = options?.requestClass ?? (actionIntent === 'none' ? 'chat_general' : 'chat_action')
    const policy = getAIRequestPolicy(requestClass)
    const traceId = buildAITraceId(requestClass)
    const startedAt = Date.now()
    const surface = options?.surface ?? 'chat'
    const systemPrompt = buildCoachSystemPrompt(context, { requestClass })
    useAIDebugStore.getState().startRequest({
      traceId,
      requestClass,
      surface,
      startedAt,
    })

    let firstChunkSeen = false

    const request: AIRequest = {
      systemPrompt,
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
      onChunk: (chunk) => {
        if (!firstChunkSeen) {
          firstChunkSeen = true
          useAIDebugStore.getState().markFirstChunk(traceId)
        }
        options?.onChunk?.(chunk)
      },
    }

    try {
      const response = await sendWithRecovery(provider, request, actionIntent)
      useAIDebugStore.getState().completeRequest(traceId, {
        provider: response.provider,
        model: response.model,
        durationMs: response.durationMs,
        retryUsed: response.retryUsed,
        fallbackUsed: response.fallbackUsed,
      })
      return response
    } catch (error) {
      useAIDebugStore.getState().failRequest(traceId, {
        errorCode: error instanceof AIProviderError ? error.code : 'unknown',
      })
      throw error
    }
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
    const name = getConfiguredProviderName()
    if (name === 'proxy') return true
    if (name === 'claude') {
      return !!(import.meta.env.VITE_CLAUDE_API_KEY ?? import.meta.env.VITE_AI_API_KEY)
    }
    if (name === 'openai') {
      return !!import.meta.env.VITE_OPENAI_API_KEY
    }
    if (name === 'gemini') {
      return !!import.meta.env.VITE_GEMINI_API_KEY
    }
    return false
  },
}

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
  const creationVerbPattern = /\b(crea(?:r|me)?|haz(?:me)?|arma(?:me)?|genera(?:r)?|planifica(?:r)?|propuesta)\b/
  const modificationVerbPattern = /\b(ajusta(?:r)?|reordena(?:r)?|mueve|cambia|agrega|quita|sube|baja|reduce|simplifica|reemplaza|incorpora)\b/
  if (!normalized) return 'none'

  if (
    /\b(plan\s+completo|todas\s+las\s+semanas|plan\s+hasta|semanas\s+hasta|completo\s+hasta|completo\s+para\s+\d+\s+semanas)\b/.test(normalized) ||
    (/\b(plan|crea(?:r|me)?)\b/.test(normalized) && /\buna\s+acción\s+create_week\s+por\s+semana\b/.test(normalized))
  ) {
    return 'create_full_plan'
  }

  if (
    creationVerbPattern.test(normalized) &&
    (
      /\b(semana|plan|microciclo)\b/.test(normalized)
      || weekDayPattern.test(normalized)
    )
  ) {
    return 'create_week'
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
  // For full plan, also retry if fewer create_week actions than expected (at least 2)
  if (actionIntent === 'create_full_plan' && response.actions && response.actions.filter((a) => a.type === 'create_week').length < 2) return true
  return false
}

function shouldRejectAfterRetry(response: CoachNormalizedResponse): boolean {
  // Solo rechazar cuando el JSON está genuinamente malformado.
  // Si el modelo simplemente no incluyó acciones, devolvemos el texto para que el usuario pueda continuar.
  return response.meta?.actionParseFailed === true
}
