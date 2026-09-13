/**
 * CoachEngine - orchestrates all AI coach interactions.
 */

import type { AIProvider, AIRequest, CoachNormalizedResponse } from './types'
import type { AIRequestClass, AITechnicalSurface, ChatContext } from '../../types'
import { buildCoachPrompt } from './promptBuilder'
import { normalizeResponse } from './responseNormalizer'
import { AIProviderError, createProviderError } from './types'
import { buildAITraceId, getAIRequestPolicy } from './requestPolicy'
import { getActiveProvider, getProviderForRequestClass, isRealProviderConfigured } from './providerResolver'
import { useAIDebugStore } from '../../store/useAIDebugStore'
import { sendGeneralWithRecovery, sendWithRecovery } from './coachRecovery'
import { resolveChatRoute } from '../chatRouting'
import { createStageTracker, trackStage, type CoachOutcome } from './stageLogger'
import { postProcessCoachActions } from './actionPostProcessor'
import { assertDailyAIRequestLimit } from './aiTelemetry'
import { persistSafetyBlockedOutcome } from './safetyOutcomeTelemetry'
import { resolveRequestTargetAthleteId } from './requestTarget'

export type CoachActionIntent = 'create_full_plan' | 'modify_plan' | 'none'
type CoachSendOptions = {
  maxTokens?: number
  temperature?: number
  onChunk?: (chunk: string) => void
  signal?: AbortSignal
  surface?: AITechnicalSurface
  /** Atleta capturado al inicio de la operación; evita leer el holder global tras un await. */
  targetAthleteId?: string | null
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
      /** Atleta explícito de la acción; el helper descarta el self. */
      targetAthleteId?: string | null
      conversation?: AIRequest['conversation']
      signal?: AbortSignal
      responseMimeType?: 'application/json'
      responseSchema?: Record<string, unknown>
      classifyResponse?: (text: string) => {
        outcome: 'ok' | 'parse_invalid' | 'schema_invalid'
        errorCode?: string
      }
    },
  ): Promise<string> {
    const requestClass = options?.requestClass ?? 'import_extract'
    const provider = getProviderForRequestClass(requestClass)
    const policy = getAIRequestPolicy(requestClass)
    const traceId = buildAITraceId(requestClass)
    const surface = options?.surface ?? 'import'
    await assertDailyAIRequestLimit(requestClass)
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
        targetAthleteId: resolveRequestTargetAthleteId(options?.targetAthleteId),
        allowFallback: policy.allowFallback,
        conversation: options?.conversation,
        systemPrompt,
        userMessage,
        maxTokens: options?.maxTokens ?? policy.maxTokens,
        temperature: options?.temperature ?? policy.temperature,
        responseMimeType: options?.responseMimeType,
        responseSchema: options?.responseSchema,
        signal: options?.signal,
      })
      const classification = options?.classifyResponse?.(raw.text)
      const telemetryPatch = {
        provider: raw.provider,
        model: raw.model,
        streamed: raw.streamed,
        durationMs: raw.durationMs,
        retryUsed: raw.retryUsed,
        fallbackUsed: raw.fallbackUsed,
        responseCharCount: raw.text.length,
        finishReason: raw.finishReason,
        promptTokens: raw.promptTokens,
        completionTokens: raw.completionTokens,
        reasoningTokens: raw.reasoningTokens,
        cacheCreationInputTokens: raw.cacheCreationInputTokens,
        cacheReadInputTokens: raw.cacheReadInputTokens,
        serviceTier: raw.serviceTier,
        reasoningEffort: raw.reasoningEffort,
        serverDurationMs: raw.serverDurationMs,
        authDurationMs: raw.authDurationMs,
        ...(classification ? { outcome: classification.outcome } : {}),
        ...(classification?.errorCode ? { errorCode: classification.errorCode } : {}),
      }
      if (classification && classification.outcome !== 'ok') {
        useAIDebugStore.getState().failRequest(traceId, telemetryPatch)
      } else {
        useAIDebugStore.getState().completeRequest(traceId, telemetryPatch)
      }
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
  const provider = getProviderForRequestClass(requestClass)
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
        targetAthleteId: resolveRequestTargetAthleteId(options?.targetAthleteId),
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

      const trackedProvider: AIProvider = {
        name: provider.name,
        call: async (trackedRequest) => {
          const raw = await provider.call(trackedRequest)
          // Capture transport before normalization, which may itself throw.
          useAIDebugStore.getState().updateRequest(traceId, { streamed: raw.streamed })
          return raw
        },
      }

      // `trackStage` cierra la etapa TAMBIÉN cuando la llamada lanza. Con el
      // cierre manual anterior, `end()` sólo se alcanzaba en el camino de
      // éxito: un fallo del proveedor no dejaba ninguna etapa `provider_call`,
      // y la traza de producción quedaba con `prompt_build` como única entrada.
      // Eso fue exactamente lo que impidió atribuir el fallo intermitente del
      // chat a uno de los tres orígenes posibles de `parse_error`.
      const result = await trackStage(tracker, 'provider_call', () => (
        requestClass === 'chat_action'
          ? sendWithRecovery(trackedProvider, request)
          : requestClass === 'chat_general'
            ? sendGeneralWithRecovery(trackedProvider, request)
            : sendDirect(trackedProvider, request)
      ))

      const postProcessedResult = requestClass === 'chat_action'
        ? postProcessCoachActions(result, context, userMessage)
        : result
      // A safety postcondition is a successful terminal decline, not a malformed
      // action response. The post-processor owns the detection because it sees
      // the fully materialized exercises; preserve that outcome here so this
      // boundary never converts it into a retryable parse error.
      const safetyBlocked = requestClass === 'chat_action'
        && (postProcessedResult.actions?.length ?? 0) === 0
        && postProcessedResult.meta?.warnings?.includes('chat_action_strength_safety_blocked') === true
      const finalResult: CoachNormalizedResponse = safetyBlocked
        ? {
            ...postProcessedResult,
            meta: {
              hadActionsMarkup: postProcessedResult.meta?.hadActionsMarkup ?? false,
              actionParseFailed: false,
              likelyTruncated: false,
              ...postProcessedResult.meta,
              outcome: 'safety_blocked',
            },
          }
        : postProcessedResult
      const hasConversationEvents = (finalResult.conversationEvents?.length ?? 0) > 0
      if (requestClass === 'chat_action' && !safetyBlocked && !hasConversationEvents && (finalResult.actions?.length ?? 0) === 0) {
        throw createProviderError(
          provider.name,
          'parse_error',
          'No pude crear una propuesta aplicable de forma segura. Intenta de nuevo.',
          true,
        )
      }
      const normalizedOutcome = finalResult.meta?.outcome
      useAIDebugStore.getState().updateRequest(traceId, {
        outcome: normalizedOutcome,
        responseCharCount: finalResult.message.length,
        actionCount: finalResult.actions?.length ?? 0,
        conversationEventCount: finalResult.conversationEvents?.length ?? 0,
        warnings: finalResult.meta?.warnings,
        transientAttempts: finalResult.transientAttempts,
        ...(safetyBlocked
          ? {
              proposalCreated: false,
              generationOutcome: 'safe_decline' as const,
              generationCompletedAt: Date.now(),
            }
          : {}),
      })
      if (safetyBlocked) void persistSafetyBlockedOutcome(traceId)
      outcome =
        normalizedOutcome === 'truncated_mid' ? 'truncated'
          : normalizedOutcome === 'truncated_early' ? 'truncated'
          : normalizedOutcome === 'parse_invalid' ? 'parse_fail'
          : normalizedOutcome === 'schema_invalid' ? 'invalid_schema'
          : normalizedOutcome === 'quality_rejected' ? 'quality_rejected'
          : normalizedOutcome === 'safety_blocked' ? 'safety_blocked'
          : 'ok'
      return finalResult
    } catch (error) {
      if (error instanceof AIProviderError) {
        outcome =
          error.code === 'timeout' ? 'timeout'
            : error.code === 'rate_limit' ? 'rate_limit'
            : error.code === 'parse_error' ? 'parse_fail'
            : 'error'
        if (error.transientAttempts !== undefined) {
          useAIDebugStore.getState().updateRequest(traceId, { transientAttempts: error.transientAttempts })
        }
      }
      throw error
    } finally {
      tracker.flush(outcome)
    }
  })
}

async function withTracing<T extends Pick<
  CoachNormalizedResponse,
  | 'provider'
  | 'model'
  | 'streamed'
  | 'durationMs'
  | 'retryUsed'
  | 'fallbackUsed'
  | 'finishReason'
  | 'promptTokens'
  | 'completionTokens'
  | 'reasoningTokens'
  | 'cacheCreationInputTokens'
  | 'cacheReadInputTokens'
  | 'serviceTier'
  | 'reasoningEffort'
  | 'serverDurationMs'
  | 'authDurationMs'
>>(
  requestClass: AIRequestClass,
  surface: AITechnicalSurface,
  run: (traceId: string) => Promise<T>,
): Promise<T> {
  const traceId = buildAITraceId(requestClass)
  await assertDailyAIRequestLimit(requestClass)
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
      streamed: result.streamed,
      durationMs: result.durationMs,
      retryUsed: result.retryUsed,
      fallbackUsed: result.fallbackUsed,
      finishReason: result.finishReason,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      reasoningTokens: result.reasoningTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens,
      cacheReadInputTokens: result.cacheReadInputTokens,
      serviceTier: result.serviceTier,
      reasoningEffort: result.reasoningEffort,
      serverDurationMs: result.serverDurationMs,
      authDurationMs: result.authDurationMs,
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
