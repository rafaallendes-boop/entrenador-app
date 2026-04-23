import type { AITechnicalSurface, ChatContext } from '../../types'
import type { CoachNormalizedResponse } from '../ai/types'
import { buildAITraceId, getAIRequestPolicy } from '../ai/requestPolicy'
import { normalizeResponse } from '../ai/responseNormalizer'
import { getActiveProvider } from '../ai/providerResolver'
import { useAIDebugStore } from '../../store/useAIDebugStore'
import { buildWeekPlanningPrompt, summarizeWeekPlanningAction } from './WeekPlanningPromptBuilder'
import { validateWeekPlanningResponse } from './validateWeekPlanningResponse'
import { buildWeekRetryInstruction } from './shared'

type WeekPlanningOptions = {
  surface?: AITechnicalSurface
  targetWeekStart: string
}

export const WeekPlanningEngine = {
  async sendWeekPlan(
    userMessage: string,
    context: ChatContext,
    options: WeekPlanningOptions,
  ): Promise<CoachNormalizedResponse> {
    const config = context.athleteProfile?.planWizardConfig
    if (!context.athleteProfile || !config) {
      return buildBlockingResponse(options.targetWeekStart)
    }

    const provider = getActiveProvider()
    const policy = getAIRequestPolicy('plan_builder_week')
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
      const traceId = buildAITraceId('plan_builder_week')
      useAIDebugStore.getState().startRequest({
        traceId,
        requestClass: 'plan_builder_week',
        surface,
        startedAt: Date.now(),
      })

      try {
        const prompt = buildWeekPlanningPrompt(context, {
          userMessage,
          targetWeekStart: options.targetWeekStart,
          retryInstruction: buildWeekRetryInstruction(lastFailure?.error, options.targetWeekStart, config.sessionsPerWeek, attempt),
          strictFormatting: attempt >= 3,
        })

        const raw = await provider.call({
          systemPrompt: prompt.systemPrompt,
          userMessage: prompt.userPrompt,
          requestClass: 'plan_builder_week',
          traceId,
          maxTokens: policy.maxTokens,
          temperature: attempt === 1 ? policy.temperature : 0.25,
          allowFallback: policy.allowFallback,
        })

        const normalized = normalizeResponse(raw)
        const validation = validateWeekPlanningResponse({
          response: normalized,
          context,
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

        return {
          ...normalized,
          message: normalized.message.trim() || summarizeWeekPlanningAction(validation.action),
          requestClass: 'plan_builder_week',
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
      message: 'No pude cerrar una semana válida todavía. Revisa tu configuración del plan y vuelve a intentarlo.',
      provider: lastFailure?.provider ?? provider.name,
      model: lastFailure?.model,
      timestamp: Date.now(),
      durationMs: lastFailure?.durationMs,
      traceId: lastFailure?.traceId ?? buildAITraceId('plan_builder_week'),
      requestClass: 'plan_builder_week',
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

function buildBlockingResponse(targetWeekStart: string): CoachNormalizedResponse {
  return {
    message: `No puedo crear una semana completa para ${targetWeekStart} porque todavía falta la configuración del plan. Completa el plan de competencia antes de pedir una semana entera.`,
    provider: 'mock',
    timestamp: Date.now(),
    traceId: buildAITraceId('plan_builder_week'),
    requestClass: 'plan_builder_week',
    meta: {
      hadActionsMarkup: false,
      actionParseFailed: false,
      likelyTruncated: false,
    },
  }
}
