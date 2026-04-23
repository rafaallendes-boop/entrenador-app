import type { AITechnicalSurface, ChatContext } from '../../types'
import type { CoachNormalizedResponse } from '../ai/types'
import { buildAITraceId, getAIRequestPolicy } from '../ai/requestPolicy'
import { normalizeResponse } from '../ai/responseNormalizer'
import { getActiveProvider } from '../ai/providerResolver'
import { useAIDebugStore } from '../../store/useAIDebugStore'
import { buildWeekCreatorPrompt, summarizeWeekCreatorAction } from './WeekCreatorPromptBuilder'
import { validateWeekCreatorResponse } from './validateWeekCreatorResponse'
import { resolveWeekCreatorConfig } from './WeekCreatorConfig'
import { buildWeekRetryInstruction } from '../week/shared'

type WeekCreatorOptions = {
  surface?: AITechnicalSurface
  targetWeekStart: string
}

export const WeekCreatorEngine = {
  async sendWeekCreate(
    userMessage: string,
    context: ChatContext,
    options: WeekCreatorOptions,
  ): Promise<CoachNormalizedResponse> {
    const config = resolveWeekCreatorConfig(context.athleteProfile)

    const provider = getActiveProvider()
    const policy = getAIRequestPolicy('week_creator')
    const surface = options.surface ?? 'chat'
    let lastFailure: {
      provider?: CoachNormalizedResponse['provider']
      model?: string
      traceId?: string
      durationMs?: number
      fallbackUsed?: boolean
      retryUsed?: boolean
      error?: string
    } | null = null

    for (let attempt = 1; attempt <= 3; attempt++) {
      const traceId = buildAITraceId('week_creator')
      useAIDebugStore.getState().startRequest({
        traceId,
        requestClass: 'week_creator',
        surface,
        startedAt: Date.now(),
      })

      try {
        const prompt = buildWeekCreatorPrompt(context, {
          userMessage,
          targetWeekStart: options.targetWeekStart,
          config,
          retryInstruction: buildWeekRetryInstruction(lastFailure?.error, options.targetWeekStart, config.sessionsPerWeek, attempt),
          strictFormatting: attempt >= 3,
        })

        const raw = await provider.call({
          systemPrompt: prompt.systemPrompt,
          userMessage: prompt.userPrompt,
          requestClass: 'week_creator',
          traceId,
          maxTokens: policy.maxTokens,
          temperature: attempt === 1 ? policy.temperature : 0.25,
          allowFallback: policy.allowFallback,
        })

        const normalized = normalizeResponse(raw)
        const validation = validateWeekCreatorResponse({
          response: normalized,
          context,
          config,
          targetWeekStart: options.targetWeekStart,
        })

        if (!validation.ok) {
          lastFailure = {
            provider: normalized.provider,
            model: normalized.model,
            traceId: normalized.traceId,
            durationMs: normalized.durationMs,
            fallbackUsed: normalized.fallbackUsed,
            retryUsed: attempt > 1 || normalized.retryUsed,
            error: validation.error,
          }
          useAIDebugStore.getState().failRequest(traceId, {
            provider: normalized.provider,
            model: normalized.model,
            durationMs: normalized.durationMs,
            retryUsed: normalized.retryUsed,
            fallbackUsed: normalized.fallbackUsed,
            errorCode: 'validation_error',
          })
          continue
        }

        useAIDebugStore.getState().completeRequest(traceId, {
          provider: normalized.provider,
          model: normalized.model,
          durationMs: normalized.durationMs,
          retryUsed: normalized.retryUsed,
          fallbackUsed: normalized.fallbackUsed,
        })

        const action = validation.action
        if (!action) {
          throw new Error('WeekCreator devolvió una validación exitosa sin acción create_week.')
        }

        return {
          ...normalized,
          actions: [action],
          message: normalized.message.trim() || summarizeWeekCreatorAction(action),
          requestClass: 'week_creator',
          retryUsed: attempt > 1 || normalized.retryUsed,
        }
      } catch (error) {
        lastFailure = {
          provider: provider.name,
          traceId,
          retryUsed: attempt > 1,
          error: error instanceof Error ? error.message : String(error),
        }
        useAIDebugStore.getState().failRequest(traceId, {
          provider: provider.name,
          errorCode: error instanceof Error ? error.message : 'unknown',
        })
      }
    }

    return {
      message: 'No pude cerrar una semana válida todavía. Revisa tu perfil y vuelve a intentarlo.',
      provider: lastFailure?.provider ?? provider.name,
      model: lastFailure?.model,
      timestamp: Date.now(),
      durationMs: lastFailure?.durationMs,
      traceId: lastFailure?.traceId ?? buildAITraceId('week_creator'),
      requestClass: 'week_creator',
      retryUsed: lastFailure?.retryUsed,
      fallbackUsed: lastFailure?.fallbackUsed,
      meta: {
        hadActionsMarkup: false,
        actionParseFailed: false,
        likelyTruncated: false,
      },
    }
  },
}
