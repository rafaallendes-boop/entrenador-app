/**
 * CoachEngine - orchestrates all AI coach interactions.
 */

import type { AIProvider, AIRequest, CoachNormalizedResponse } from './types'
import type { AIRequestClass, AITechnicalSurface, ChatContext } from '../../types'
import { buildCoachPrompt } from './promptBuilder'
import { normalizeResponse } from './responseNormalizer'
import { AIProviderError } from './types'
import { buildAITraceId, getAIRequestPolicy } from './requestPolicy'
import { getActiveProvider, isRealProviderConfigured } from './providerResolver'
import { useAIDebugStore } from '../../store/useAIDebugStore'
import { sendWithRecovery } from './coachRecovery'
import { resolveChatRoute } from '../chatRouting'
import { createStageTracker, type CoachOutcome } from './stageLogger'
import { postProcessCoachActions } from './actionPostProcessor'

export type CoachActionIntent = 'create_full_plan' | 'modify_plan' | 'none'
type CoachSendOptions = {
  maxTokens?: number
  temperature?: number
  onChunk?: (chunk: string) => void
  signal?: AbortSignal
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
    return sendTrackedCoachRequest(userMessage, context, 'chat_general', options)
  },

  async sendAction(
    userMessage: string,
    context: ChatContext,
    options?: CoachSendOptions,
  ): Promise<CoachNormalizedResponse> {
    return sendTrackedCoachRequest(userMessage, context, 'chat_action', options)
  },

  async send(
    userMessage: string,
    context: ChatContext,
    options?: CoachDispatcherOptions,
  ): Promise<CoachNormalizedResponse> {
    if (options?.requestClass === 'weekly_summary') {
      return sendTrackedCoachRequest(userMessage, context, 'weekly_summary', options)
    }

    if (options?.requestClass === 'chat_general') {
      return this.sendChat(userMessage, context, options)
    }

    if (options?.requestClass === 'chat_action') {
      return this.sendAction(userMessage, context, options)
    }

    const route = resolveChatRoute(userMessage, context)
    return route.kind === 'chat_action'
      ? this.sendAction(userMessage, context, options)
      : this.sendChat(userMessage, context, options)
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
      signal?: AbortSignal
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
        signal: options?.signal,
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
  options?: CoachSendOptions,
): Promise<CoachNormalizedResponse> {
  const provider = getActiveProvider()
  const policy = getAIRequestPolicy(requestClass)
  const surface = options?.surface ?? 'chat'

  return withTracing(requestClass, surface, async (traceId) => {
    const tracker = createStageTracker(traceId, requestClass)
    let outcome: CoachOutcome = 'error'
    try {
      let firstChunkSeen = false
      const promptStage = tracker.stage('prompt_build')
      const prompt = buildCoachPrompt(context, { requestClass, userMessage })
      promptStage.end({ ok: true })

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
        signal: options?.signal,
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

      const providerStage = tracker.stage('provider_call')
      const result = requestClass === 'chat_action'
        ? await sendWithRecovery(provider, request)
        : await sendDirect(provider, request)
      providerStage.end({ ok: true })

      const finalResult = requestClass === 'chat_action'
        ? postProcessCoachActions(result, context, userMessage)
        : result
      const normalizedOutcome = result.meta?.outcome
      outcome =
        normalizedOutcome === 'truncated_mid' ? 'truncated'
          : normalizedOutcome === 'truncated_early' ? 'truncated'
          : normalizedOutcome === 'parse_invalid' ? 'parse_fail'
          : normalizedOutcome === 'schema_invalid' ? 'invalid_schema'
          : 'ok'
      return finalResult
    } catch (error) {
      if (error instanceof AIProviderError) {
        outcome =
          error.code === 'timeout' ? 'timeout'
            : error.code === 'rate_limit' ? 'rate_limit'
            : error.code === 'parse_error' ? 'parse_fail'
            : 'error'
      }
      throw error
    } finally {
      tracker.flush(outcome)
    }
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

/** Nivel 1 — direct call without format retry (chat_general). */
async function sendDirect(
  provider: AIProvider,
  request: AIRequest,
): Promise<CoachNormalizedResponse> {
  const raw = await provider.call(request)
  return normalizeResponse(raw)
}

export function inferCoachActionIntent(userMessage: string): CoachActionIntent {
  switch (resolveChatRoute(userMessage).kind) {
    case 'plan_builder_redirect':
      return 'create_full_plan'
    case 'chat_action':
      return 'modify_plan'
    default:
      return 'none'
  }
}
