/**
 * CoachEngine - orchestrates all AI coach interactions.
 */

import type { AIProvider, AIRequest, CoachNormalizedResponse } from './types'
import type { ChatContext } from '../../types'
import { buildCoachSystemPrompt } from './promptBuilder'
import { normalizeResponse } from './responseNormalizer'
import { createProviderError } from './types'
import { ClaudeProvider } from './providers/ClaudeProvider'
import { OpenAIProvider } from './providers/OpenAIProvider'
import { MockProvider } from './providers/MockProvider'
import { GeminiProvider } from './providers/GeminiProvider'
import { ProxyProvider } from './providers/ProxyProvider'

export type CoachActionIntent = 'create_week' | 'modify_plan' | 'none'

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
    options?: { maxTokens?: number; temperature?: number; onChunk?: (chunk: string) => void },
  ): Promise<CoachNormalizedResponse> {
    const provider = getActiveProvider()
    const systemPrompt = buildCoachSystemPrompt(context)
    const actionIntent = inferCoachActionIntent(userMessage)

    const request: AIRequest = {
      systemPrompt,
      userMessage,
      conversation: (context.recentMessages ?? []).map(message => ({
        role: message.role === 'coach' ? 'assistant' : 'user',
        content: message.content,
      })),
      maxTokens: options?.maxTokens ?? (actionIntent === 'create_week' ? 5000 : actionIntent === 'modify_plan' ? 3600 : 3000),
      temperature: options?.temperature ?? 0.7,
      onChunk: options?.onChunk,
    }

    return sendWithRecovery(provider, request, actionIntent)
  },

  async extractRaw(
    systemPrompt: string,
    userMessage: string,
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<string> {
    const provider = getActiveProvider()
    const raw = await provider.call({
      systemPrompt,
      userMessage,
      maxTokens: options?.maxTokens ?? 2000,
      temperature: options?.temperature ?? 0.1,
    })
    return raw.text
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

  if (shouldRejectAfterRetry(retryNormalized, actionIntent)) {
    throw createProviderError(
      provider.name,
      'parse_error',
      actionIntent === 'none'
        ? 'El coach devolvio una respuesta invalida en el bloque de acciones.'
        : 'El coach no devolvio acciones aplicables para la solicitud del usuario.',
      true,
    )
  }

  return {
    ...retryNormalized,
    meta: {
      hadActionsMarkup: retryNormalized.meta?.hadActionsMarkup ?? false,
      actionParseFailed: retryNormalized.meta?.actionParseFailed ?? false,
      likelyTruncated: retryNormalized.meta?.likelyTruncated ?? false,
      retryUsed: true,
    },
  }
}

export function inferCoachActionIntent(userMessage: string): CoachActionIntent {
  const normalized = userMessage.trim().toLowerCase()
  if (!normalized) return 'none'

  if (
    /\b(crea(?:r|me)?|haz(?:me)?|arma(?:me)?|genera(?:r)?|planifica(?:r)?|propuesta)\b/.test(normalized) &&
    /\b(semana|plan|microciclo)\b/.test(normalized)
  ) {
    return 'create_week'
  }

  if (
    /\b(ajusta(?:r)?|reordena(?:r)?|mueve|cambia|agrega|quita|sube|baja|reduce|simplifica|reemplaza|incorpora)\b/.test(normalized) &&
    /\b(semana|sesion|sesión|plan|carga|running|squash|fuerza|cycling|ciclismo|movilidad)\b/.test(normalized)
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

function shouldRejectAfterRetry(response: CoachNormalizedResponse, actionIntent: CoachActionIntent): boolean {
  if (response.meta?.actionParseFailed) return true
  if (actionIntent !== 'none' && (!response.actions || response.actions.length === 0)) return true
  return false
}
