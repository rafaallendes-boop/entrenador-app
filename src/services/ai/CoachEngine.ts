/**
 * CoachEngine — orchestrador central para todas las interacciones con el coach AI.
 *
 * Flujo en PRODUCCIÓN (Netlify deploy):
 *   Usuario → CoachEngine → ProxyProvider → /.netlify/functions/coach → Gemini/OpenAI/Claude
 *   La API key vive solo en el servidor. El frontend no la ve nunca.
 *
 * Flujo en DESARROLLO LOCAL:
 *   VITE_AI_PROVIDER=mock   → MockProvider (offline, sin API key)
 *   VITE_AI_PROVIDER=proxy  → ProxyProvider → requiere `netlify dev` corriendo
 *   VITE_AI_PROVIDER=gemini → GeminiProvider directo (requiere VITE_GEMINI_API_KEY en .env)
 *   VITE_AI_PROVIDER=claude → ClaudeProvider directo (requiere VITE_CLAUDE_API_KEY)
 *   VITE_AI_PROVIDER=openai → OpenAIProvider directo (requiere VITE_OPENAI_API_KEY)
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

function getConfiguredProviderName(): string {
  // En producción siempre usa el proxy seguro (la key está en el servidor)
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
      return new GeminiProvider()  // solo para dev local con VITE_GEMINI_API_KEY
    default:
      return new MockProvider()
  }
}

export const CoachEngine = {
  /**
   * Envía un mensaje al proveedor AI activo y retorna una respuesta normalizada.
   * El system prompt se construye automáticamente desde el contexto.
   */
  async send(
    userMessage: string,
    context: ChatContext,
    options?: { maxTokens?: number; temperature?: number; onChunk?: (chunk: string) => void },
  ): Promise<CoachNormalizedResponse> {
    const provider = getActiveProvider()
    const systemPrompt = buildCoachSystemPrompt(context)

    const request: AIRequest = {
      systemPrompt,
      userMessage,
      conversation: (context.recentMessages ?? []).map(message => ({
        role: message.role === 'coach' ? 'assistant' : 'user',
        content: message.content,
      })),
      maxTokens: options?.maxTokens ?? 3000,
      temperature: options?.temperature ?? 0.7,
      onChunk: options?.onChunk,
    }

    return sendWithRecovery(provider, request)
  },

  /**
   * Retorna el nombre del proveedor activo.
   * Usado para el badge en la UI del chat.
   */
  getProviderName(): string {
    return getActiveProvider().name
  },

  /**
   * Retorna true si hay un proveedor real (no mock) configurado.
   * Usado para mostrar el badge "Demo" vs "Gemini Flash" etc.
   */
  isRealProviderConfigured(): boolean {
    const name = getConfiguredProviderName()
    // Proxy siempre es real (conecta al servidor con la key)
    if (name === 'proxy') return true
    // Providers directos (solo dev local)
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
): Promise<CoachNormalizedResponse> {
  const firstRaw = await provider.call(request)
  const firstNormalized = normalizeResponse(firstRaw)

  if (!shouldRetry(firstNormalized)) {
    return firstNormalized
  }

  const retryRaw = await provider.call({
    ...request,
    systemPrompt: `${request.systemPrompt}\n\nIMPORTANTE DE FORMATO:\n- Si usas <actions>, cierra siempre con </actions>.\n- El contenido dentro de <actions> debe ser JSON valido.\n- Si no puedes devolver JSON valido, responde solo con texto limpio y sin <actions>.`,
    temperature: Math.min(request.temperature ?? 0.7, 0.3),
    onChunk: undefined, // retry is silent — no streaming
  })
  const retryNormalized = normalizeResponse(retryRaw)

  if (shouldRejectAfterRetry(retryNormalized)) {
    throw createProviderError(
      provider.name,
      'parse_error',
      'El coach devolvio una respuesta invalida en el bloque de acciones.',
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

function shouldRetry(response: CoachNormalizedResponse): boolean {
  return !!(response.meta?.actionParseFailed || response.meta?.likelyTruncated)
}

function shouldRejectAfterRetry(response: CoachNormalizedResponse): boolean {
  return !!response.meta?.actionParseFailed && !response.message.trim()
}
