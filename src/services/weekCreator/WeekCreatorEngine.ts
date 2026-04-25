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
  signal?: AbortSignal
}

export const WeekCreatorEngine = {
  async sendWeekCreate(
    userMessage: string,
    context: ChatContext,
    options: WeekCreatorOptions,
  ): Promise<CoachNormalizedResponse> {
    const config = resolveWeekCreatorConfig(context.athleteProfile)

    if (config.configSource === 'defaults') {
      return {
        message: 'Para proponer una semana necesito conocer tus deportes y disponibilidad horaria. ¿Quieres completar tu perfil de atleta primero? Puedes hacerlo desde Configuración → Perfil de atleta.',
        actions: [],
        provider: 'mock',
        model: 'none',
        timestamp: Date.now(),
        traceId: buildAITraceId('week_creator'),
        requestClass: 'week_creator',
        durationMs: 0,
        retryUsed: false,
        fallbackUsed: false,
        meta: { hadActionsMarkup: false, actionParseFailed: false, likelyTruncated: false },
      }
    }

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

    const MAX_ATTEMPTS = 2
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
          strictFormatting: attempt >= 2,
        })

        const raw = await provider.call({
          systemPrompt: prompt.systemPrompt,
          userMessage: prompt.userPrompt,
          requestClass: 'week_creator',
          traceId,
          maxTokens: policy.maxTokens,
          temperature: attempt === 1 ? policy.temperature : 0.25,
          allowFallback: policy.allowFallback,
          signal: options.signal,
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
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[WeekCreatorEngine] validation failed', {
              attempt,
              traceId,
              error: validation.error,
            })
          }
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
        const message = normalized.message.trim() || summarizeWeekCreatorAction(action)
        const messageWithWarning = validation.warning
          ? `${message}\n\nNota: ${validation.warning}`
          : message

        return {
          ...normalized,
          actions: [action],
          message: messageWithWarning,
          requestClass: 'week_creator',
          retryUsed: attempt > 1 || normalized.retryUsed,
          meta: validation.warning && normalized.meta
            ? { ...normalized.meta, likelyTruncated: false }
            : normalized.meta,
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

    // After exhausting retries, surface a real error to the chat store catch
    // block so the UI shows it instead of staying in an infinite loading state.
    const failureMessage = lastFailure?.error
      ? `No pude generar la semana después de ${MAX_ATTEMPTS} intentos: ${lastFailure.error}`
      : `No pude generar una semana válida después de ${MAX_ATTEMPTS} intentos. Revisa tu perfil y vuelve a intentarlo.`
    const failureTraceId = lastFailure?.traceId ?? buildAITraceId('week_creator')
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[WeekCreatorEngine] all attempts failed', {
        traceId: failureTraceId,
        provider: lastFailure?.provider,
        error: lastFailure?.error,
      })
    }
    throw new Error(`${failureMessage} (trace ${failureTraceId})`)
  },
}
