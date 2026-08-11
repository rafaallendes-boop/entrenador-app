import type {
  AITechnicalSurface,
  AITechnicalResult,
  AthleteProfile,
  ChatContext,
  CoachAction,
  CoachExerciseProposal,
  CoachSessionProposal,
  DayOfWeek,
  SquashDrill,
  SquashSessionBlock,
  SquashSessionMode,
  SquashTrainingFocus,
  SupportedSport,
  TimeBlock,
} from '../../types'
import type { TrainingPlanWeek } from '../../types/planBuilder'
import type { AIProvider, AIRawResponse, CoachNormalizedResponse } from '../ai/types'
import { buildAIGenerationId, buildAITraceId, getAIRequestPolicy, resolveWeekCreatorMaxTokens } from '../ai/requestPolicy'
import { assertDailyAIRequestLimit } from '../ai/aiTelemetry'
import { normalizeResponse } from '../ai/responseNormalizer'
import { getProviderForRequestClass } from '../ai/providerResolver'
import { useAIDebugStore } from '../../store/useAIDebugStore'
import { createStageTracker, type CoachOutcome } from '../ai/stageLogger'
import { buildWeekCreatorPrompt, summarizeWeekCreatorAction } from './WeekCreatorPromptBuilder'
import { validateWeekCreatorResponse } from './validateWeekCreatorResponse'
import { resolveWeekCreatorConfig, type WeekCreatorEffectiveConfig, withRequestedSessionsPerWeek } from './WeekCreatorConfig'
import { filterSessionsToWeek, isStrictISODate } from '../week/shared'
import { repairGeneratedWeek, type RepairFailure, type RepairMeta } from '../planBuilder/repairWeek'
import { recordRepairAction, summarizeTaxonomy } from '../planBuilder/repairTaxonomy'
import { isLocalFallbackEligible } from '../planBuilder/fallbackEligibility'
import { WEEK_CREATOR_RESPONSE_SCHEMA } from './weekCreatorResponseSchema'
import { enhanceStrengthSessionExercises } from '../training/strengthSessionStructure'
import { getStrengthExerciseIdentityById } from '../training/exerciseLibrary'
import { todayISO } from '../../utils/date'
import { applyWeekCreatorDateWindowToConfig, resolveWeekCreatorDateWindow } from './WeekCreatorDateWindow'
import { db } from '../../db/db'
import {
  alignSessionsToScheduleConstraints,
  buildScheduleAwareConfig,
  resolveDayScheduleConstraint,
  resolveScheduleCapacity,
} from './scheduleConstraints'
import {
  classifyWeekCreatorProviderFailure,
  classifyWeekCreatorRepairFailure,
  classifyWeekCreatorValidationFailure,
  type WeekCreatorFailure,
  type WeekCreatorFailureCategory,
  type WeekCreatorFailureCode,
} from './WeekCreatorFailurePolicy'
import { buildWeekCreatorTargetedRepairPrompt } from './WeekCreatorRepairPromptBuilder'
import { buildWeekCreatorSkeletonPrompt } from './WeekCreatorSkeletonPromptBuilder'
import { WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA } from './weekCreatorSkeletonSchema'
import { parseWeekCreatorSkeletonResponse } from './parseWeekCreatorSkeletonResponse'
import type { WeekCreatorSkeleton } from './weekCreatorSkeleton'
import { resolveWeekCreatorContractStrategy } from './weekCreatorContractStrategy'
import {
  hasActiveMedicalRestrictions,
  buildWeekCreatorHydrationRepairContext,
  hydrateWeekCreatorResponse,
  hydrateWeekCreatorSkeleton,
  type WeekCreatorHydrationResult,
} from './WeekCreatorLocalHydrator'

const WEEK_CREATOR_RESPONSE_SCHEMA_CHAR_COUNT = JSON.stringify(WEEK_CREATOR_RESPONSE_SCHEMA).length
const WEEK_CREATOR_SKELETON_SCHEMA_CHAR_COUNT = JSON.stringify(WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA).length

/**
 * Objetivos de la semana objetivo cuando existe un plan activo que la cubre.
 * Best-effort: cualquier fallo de lectura devuelve [] y el prompt usa el
 * fallback de intención semanal del macro plan.
 */
export async function resolveActivePlanWeekObjectives(
  targetWeekStart: string,
  athleteId?: string,
): Promise<string[]> {
  try {
    const candidateWeeks = await db.trainingPlanWeeks
      .where('weekStartDate')
      .equals(targetWeekStart)
      .toArray()
    if (candidateWeeks.length === 0) return []

    for (const week of candidateWeeks) {
      const plan = await db.trainingPlans.get(week.planId)
      if (plan?.status !== 'active') continue
      if (athleteId && plan.athleteId !== athleteId) continue
      const objectives = normalizePlanWeekObjectives(week.weekObjectives)
      if (objectives.length > 0) return objectives
    }
    return []
  } catch {
    return []
  }
}

function normalizePlanWeekObjectives(weekObjectives: TrainingPlanWeek['weekObjectives'] | undefined): string[] {
  if (!Array.isArray(weekObjectives)) return []
  return weekObjectives
    .map((objective) => objective.goal?.trim() ?? '')
    .filter(Boolean)
}

type WeekCreatorOptions = {
  surface?: AITechnicalSurface
  targetWeekStart: string
  today?: string
  signal?: AbortSignal
  /** Override de objetivos semanales; si falta, se resuelven desde el plan activo en Dexie. */
  weekObjectives?: string[]
  /** Inyección interna para tests y load tests que deben ejecutar el engine completo. */
  provider?: AIProvider
  /** ID estable opcional para correlacionar una generación controlada. */
  generationId?: string
}

type WeekCreatorCohort = Pick<
  AITechnicalResult,
  | 'expectedSessionCount'
  | 'trainingDayCount'
  | 'allowedSportCount'
  | 'doubleSessionAllowed'
  | 'partialWeek'
  | 'activeRestrictionsPresent'
>

type SquashFallbackVariant = {
  title: string
  objective: string
  trainingFocus: SquashTrainingFocus
  sessionMode: SquashSessionMode
  sessionKind: 'technical' | 'control' | 'shadows' | 'match' | 'mixed'
  blocks: SquashSessionBlock[]
}

export const WeekCreatorEngine = {
  async sendWeekCreate(
    userMessage: string,
    context: ChatContext,
    options: WeekCreatorOptions,
  ): Promise<CoachNormalizedResponse> {
    const generationId = options.generationId ?? buildAIGenerationId('week_creator')
    const baseConfig = withRequestedSessionsPerWeek(
      resolveWeekCreatorConfig(context.athleteProfile),
      userMessage,
    )

    if (baseConfig.configSource === 'defaults') {
      return {
        message: 'Para proponer una semana necesito conocer tus deportes y disponibilidad horaria. ¿Quieres completar tu perfil de atleta primero? Puedes hacerlo desde Configuración → Perfil de atleta.',
        actions: [],
        provider: 'mock',
        model: 'none',
        timestamp: Date.now(),
        traceId: buildAITraceId('week_creator'),
        generationId,
        requestClass: 'week_creator',
        durationMs: 0,
        retryUsed: false,
        fallbackUsed: false,
        meta: { hadActionsMarkup: false, actionParseFailed: false, likelyTruncated: false },
      }
    }

    if (!isStrictISODate(options.targetWeekStart)) {
      return {
        message: 'No pude determinar la semana objetivo. Vuelve a intentarlo indicando la semana que quieres planificar.',
        actions: [],
        provider: 'mock',
        model: 'none',
        timestamp: Date.now(),
        traceId: buildAITraceId('week_creator'),
        generationId,
        requestClass: 'week_creator',
        durationMs: 0,
        retryUsed: false,
        fallbackUsed: false,
        meta: { hadActionsMarkup: false, actionParseFailed: false, likelyTruncated: false },
      }
    }

    const dateWindow = resolveWeekCreatorDateWindow(options.targetWeekStart, options.today ?? todayISO())
    const config = applyWeekCreatorDateWindowToConfig(baseConfig, dateWindow)
    const weekObjectives = options.weekObjectives
      ?? await resolveActivePlanWeekObjectives(options.targetWeekStart, context.athleteProfile?.id)

    const provider = options.provider ?? getProviderForRequestClass('week_creator')
    const policy = getAIRequestPolicy('week_creator')
    const surface = options.surface ?? 'chat'
    const cohort = buildWeekCreatorCohort(context, config, options.targetWeekStart, dateWindow.planningStartDate)
    // Free-text medical restrictions still use the detailed provider contract.
    // Local selectors cannot safely infer exercise adaptations from arbitrary diagnoses.
    const useSkeletonContract = resolveWeekCreatorContractStrategy() === 'skeleton_v2'
      && !hasActiveMedicalRestrictions(context, config)
    const weekCreatorContract = useSkeletonContract ? 'skeleton_v2' as const : 'detailed' as const
    // The detailed (medical) contract carries full per-sport detail and was
    // observed truncating at the skeleton-sized 2500 cap; give it headroom.
    const effectiveMaxTokens = resolveWeekCreatorMaxTokens(useSkeletonContract)
    const responseSchema = useSkeletonContract
      ? WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA
      : WEEK_CREATOR_RESPONSE_SCHEMA
    const responseSchemaCharCount = useSkeletonContract
      ? WEEK_CREATOR_SKELETON_SCHEMA_CHAR_COUNT
      : WEEK_CREATOR_RESPONSE_SCHEMA_CHAR_COUNT
    const scheduleCapacity = buildFallbackSlots(
      config,
      options.targetWeekStart,
      config.sessionsPerWeek,
      dateWindow.planningStartDate,
    ).length
    if (scheduleCapacity < config.sessionsPerWeek) {
      return buildInsufficientScheduleCapacityResponse({
        generationId,
        surface,
        config,
        cohort,
        availableSlots: scheduleCapacity,
      })
    }
    // Declaring a daily cap for `week_creator` is not enforcing it: this engine
    // never checked it, so a canary run drove usage past the limit. Guard here,
    // after the cheap config/capacity preflights, so a misconfigured week is not
    // reported to the user as a rate limit.
    await assertDailyAIRequestLimit('week_creator')

    let lastFailure: (WeekCreatorFailure & {
      provider?: CoachNormalizedResponse['provider']
      model?: string
      traceId?: string
      durationMs?: number
      fallbackUsed?: boolean
      retryUsed?: boolean
      failedResponse?: CoachNormalizedResponse
      failedSkeleton?: WeekCreatorSkeleton
    }) | null = null

    const MAX_ATTEMPTS = 2
    let providerAttempts = 0
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      providerAttempts = attempt
      const traceId = buildAITraceId('week_creator')
      const tracker = createStageTracker(traceId, 'week_creator')
      let outcome: CoachOutcome = 'error'
      let raw: AIRawResponse | undefined
      useAIDebugStore.getState().startRequest({
        traceId,
        generationId,
        attempt,
        requestClass: 'week_creator',
        surface,
        startedAt: Date.now(),
        maxTokens: effectiveMaxTokens,
        weekCreatorContract,
        ...cohort,
      })

      try {
        const promptStage = tracker.stage('prompt_build')
        let prompt
        if (lastFailure?.decision === 'targeted_model_repair' && lastFailure.failedResponse) {
          prompt = buildWeekCreatorTargetedRepairPrompt(context, {
              userMessage,
              targetWeekStart: options.targetWeekStart,
              planningStartDate: dateWindow.planningStartDate,
              weekEndDate: dateWindow.weekEndDate,
              config,
              failure: lastFailure,
              failedResponse: lastFailure.failedResponse,
              failedSkeleton: lastFailure.failedSkeleton,
              skeletonOutput: useSkeletonContract,
            })
        } else {
          // The only way to reach a second attempt on this branch is a provider
          // failure, which retries the identical prompt. Every validation
          // failure either ends locally or takes the targeted-repair branch
          // above, so there is no generic "you got it wrong, try again" retry
          // instruction to build anymore.
          const basePrompt = buildWeekCreatorPrompt(context, {
              userMessage,
              targetWeekStart: options.targetWeekStart,
              planningStartDate: dateWindow.planningStartDate,
              weekEndDate: dateWindow.weekEndDate,
              config,
              strictFormatting: true,
              structuredOutput: true,
              skeletonOutput: useSkeletonContract,
              weekObjectives,
            })
          prompt = useSkeletonContract
            ? buildWeekCreatorSkeletonPrompt({ userPrompt: basePrompt.userPrompt })
            : basePrompt
        }
        promptStage.end({ ok: true })
        useAIDebugStore.getState().updateRequest(traceId, {
          systemPromptCharCount: prompt.systemPrompt.length,
          userPromptCharCount: prompt.userPrompt.length,
          responseSchemaCharCount,
          inputCharCount: prompt.systemPrompt.length + prompt.userPrompt.length + responseSchemaCharCount,
        })

        const providerStage = tracker.stage('provider_call')
        try {
          raw = await provider.call({
            systemPrompt: prompt.systemPrompt,
            userMessage: prompt.userPrompt,
            requestClass: 'week_creator',
            traceId,
            generationId,
            logicalAttempt: attempt,
            maxTokens: effectiveMaxTokens,
            temperature: Math.min(policy.temperature, 0.15),
            responseMimeType: 'application/json',
            responseSchema,
            allowFallback: policy.allowFallback,
            signal: options.signal,
          })
          providerStage.end({ ok: true })
        } catch (error) {
          providerStage.end({ ok: false, error: error instanceof Error ? error.message : String(error) })
          throw error
        }

        const normalizeStage = tracker.stage('normalize')
        const skeletonParse = useSkeletonContract
          ? parseWeekCreatorSkeletonResponse(raw.text)
          : undefined
        const providerSkeleton = skeletonParse?.ok ? skeletonParse.skeleton : undefined
        const normalized = normalizeResponse(raw)
        normalizeStage.end({
          ok: !useSkeletonContract || providerSkeleton != null || (normalized.actions?.length ?? 0) > 0,
          error: useSkeletonContract && !providerSkeleton && (normalized.actions?.length ?? 0) === 0
            ? 'El proveedor no devolvió un esqueleto semanal recuperable.'
            : undefined,
        })

        let hydration: WeekCreatorHydrationResult | undefined
        if (useSkeletonContract) {
          const hydrateStage = tracker.stage('hydrate')
          hydration = providerSkeleton
            ? hydrateWeekCreatorSkeleton({
                skeleton: providerSkeleton,
                response: normalized,
                context,
                config,
                targetWeekStart: options.targetWeekStart,
                planningStartDate: dateWindow.planningStartDate,
              })
            : hydrateWeekCreatorResponse({
                response: normalized,
                context,
                config,
                targetWeekStart: options.targetWeekStart,
                planningStartDate: dateWindow.planningStartDate,
              })
          hydrateStage.end({
            ok: hydration.status === 'hydrated' || hydration.status === 'unchanged',
            error: hydration.status === 'skipped_invalid_shape' || hydration.status === 'repair_failed'
              ? hydration.warnings[0]
              : undefined,
          })
        }

        const repairStage = tracker.stage('repair')
        const locallyCompleted = hydration?.repairFailure
          ? toRepairFailedWeekCreatorResponse(hydration.response, hydration.repairFailure)
          : repairWeekCreatorResponse(
              hydration?.response ?? normalized,
              context,
              config,
              options.targetWeekStart,
              dateWindow.planningStartDate,
            )
        const repaired = mergeWeekCreatorHydration(locallyCompleted, hydration)
        if (repaired.repairFailure) {
          const failure = classifyWeekCreatorRepairFailure(repaired.repairFailure)
          outcome = 'quality_rejected'
          lastFailure = {
            ...failure,
            provider: repaired.provider,
            model: repaired.model,
            traceId: repaired.traceId,
            durationMs: repaired.durationMs,
            fallbackUsed: repaired.fallbackUsed,
            retryUsed: attempt > 1 || repaired.retryUsed,
            failedResponse: repaired,
            failedSkeleton: providerSkeleton,
          }
          repairStage.end({ ok: false, error: failure.error })
          useAIDebugStore.getState().failRequest(traceId, {
            errorCode: repaired.repairFailure.errorClass,
            outcome: failure.outcome,
            warnings: failure.warnings,
            ...buildRawTelemetry(raw),
            stageTimings: tracker.timings(),
            repairStats: buildRepairStats(repaired.repairMeta, repaired.hydrationRepairMeta),
          })
          tracker.flush(outcome, {
            generationId,
            attempt,
            failureCode: failure.code,
            failureCategory: failure.category,
            repairErrorClass: repaired.repairFailure.errorClass,
          })
          if (attempt < MAX_ATTEMPTS) continue
          break
        }
        repairStage.end({ ok: true })

        const validateStage = tracker.stage('validate')
        const validation = validateWeekCreatorResponse({
          response: repaired,
          context,
          config,
          targetWeekStart: options.targetWeekStart,
          planningStartDate: dateWindow.planningStartDate,
        })
        validateStage.end({ ok: validation.ok, error: validation.ok ? undefined : validation.error })

        if (!validation.ok) {
          const failure = classifyWeekCreatorValidationFailure({
            validationCode: validation.code,
            error: validation.error,
            response: repaired,
            activeRestrictionsPresent: cohort.activeRestrictionsPresent === true,
          })
          outcome = 'invalid_schema'
          lastFailure = {
            ...failure,
            provider: repaired.provider,
            model: repaired.model,
            traceId: repaired.traceId,
            durationMs: repaired.durationMs,
            fallbackUsed: repaired.fallbackUsed,
            retryUsed: attempt > 1 || repaired.retryUsed,
            failedResponse: repaired,
            failedSkeleton: providerSkeleton,
          }
          useAIDebugStore.getState().failRequest(traceId, {
            errorCode: failure.code,
            outcome: failure.outcome,
            warnings: failure.warnings,
            ...buildRawTelemetry(raw),
            stageTimings: tracker.timings(),
            repairStats: buildRepairStats(repaired.repairMeta, repaired.hydrationRepairMeta),
          })
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[WeekCreatorEngine] validation failed', {
              attempt,
              traceId,
              error: validation.error,
            })
          }
          tracker.flush(outcome, {
            generationId,
            attempt,
            failureCode: failure.code,
            failureCategory: failure.category,
            validationError: failure.error,
          })
          if (failure.decision !== 'local_fallback' && attempt < MAX_ATTEMPTS) continue
          break
        }

        useAIDebugStore.getState().completeRequest(traceId, {
          ...buildRawTelemetry(raw),
          stageTimings: tracker.timings(),
          repairStats: buildRepairStats(repaired.repairMeta, repaired.hydrationRepairMeta),
        })

        const action = validation.action
        if (!action) {
          throw new Error('WeekCreator devolvió una validación exitosa sin acción create_week.')
        }
        const message = repaired.meta?.likelyTruncated
          ? summarizeWeekCreatorAction(action)
          : repaired.message.trim() || summarizeWeekCreatorAction(action)
        const warnings = [
          validation.warning,
          ...repaired.repairWarnings,
        ].filter((warning): warning is string => Boolean(warning?.trim()))
        const messageWithWarning = warnings.length > 0
          ? `${message}\n\nNota: ${warnings.join(' ')}`
          : message

        outcome = 'ok'
        tracker.flush(outcome, { generationId, attempt })
        return {
          ...repaired,
          generationId,
          actions: [action],
          message: messageWithWarning,
          requestClass: 'week_creator',
          retryUsed: attempt > 1 || repaired.retryUsed,
          // A fully validated create_week action is complete and safe even when
          // the provider reported a token stop after closing the JSON payload.
          // Keep the raw finishReason in telemetry, but do not surface a false
          // "Respuesta truncada" warning to the athlete.
          meta: repaired.meta
            ? { ...repaired.meta, likelyTruncated: false, outcome: 'ok' }
            : repaired.meta,
        }
      } catch (error) {
        outcome = 'error'
        // A user/watchdog abort must short-circuit: no retry and no deterministic
        // fallback week, otherwise we silently hand back a plan nobody asked for.
        if (isAbortError(error, options.signal)) {
          useAIDebugStore.getState().failRequest(traceId, {
            provider: provider.name,
            errorCode: 'aborted',
            warnings: ['week_creator_aborted'],
            ...buildRawTelemetry(raw),
            stageTimings: tracker.timings(),
          })
          tracker.flush(outcome, { generationId, attempt, aborted: true })
          throw error instanceof Error ? error : new Error(String(error))
        }
        const failure = classifyWeekCreatorProviderFailure(error)
        lastFailure = {
          ...failure,
          provider: provider.name,
          traceId,
          retryUsed: attempt > 1,
        }
        useAIDebugStore.getState().failRequest(traceId, {
          provider: provider.name,
          errorCode: 'provider_error',
          warnings: lastFailure.warnings,
          ...buildRawTelemetry(raw),
          stageTimings: tracker.timings(),
        })
        tracker.flush(outcome, {
          generationId,
          attempt,
          failureCode: failure.code,
          failureCategory: failure.category,
          error: lastFailure.error,
        })
        if (attempt >= MAX_ATTEMPTS) break
      }
    }

    // A quality fail-closed rejection must not be turned into a deterministic
    // fallback week. The candidate remains rejected after its retries.
    if (lastFailure && !isLocalFallbackEligible(lastFailure.code)) {
      return buildWeekCreatorRepairFailureResponse({
        generationId,
        provider: lastFailure.provider ?? provider.name,
        model: lastFailure.model,
        traceId: lastFailure.traceId ?? buildAITraceId('week_creator'),
        durationMs: lastFailure.durationMs,
        retryUsed: providerAttempts > 1,
      })
    }

    // Build the conservative local result after the typed policy stops model
    // attempts (immediately for ambiguous/local cases, after retry otherwise).
    const failureMessage = buildWeekCreatorUserFailureMessage(lastFailure?.code)
    const failureTraceId = lastFailure?.traceId ?? buildAITraceId('week_creator')
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[WeekCreatorEngine] using deterministic fallback', {
        traceId: failureTraceId,
        provider: lastFailure?.provider,
        error: lastFailure?.error,
      })
    }
    const fallbackTraceId = buildAITraceId('week_creator')
    const fallbackStartedAt = Date.now()
    const fallbackTracker = createStageTracker(fallbackTraceId, 'week_creator')
    useAIDebugStore.getState().startRequest({
      traceId: fallbackTraceId,
      generationId,
      attempt: providerAttempts + 1,
      requestClass: 'week_creator',
      surface,
      startedAt: fallbackStartedAt,
      maxTokens: effectiveMaxTokens,
      weekCreatorContract,
      ...cohort,
    })
    // Cierre único de las dos salidas de falla del fallback. Existía solo la
    // rama de validación; construir el fallback fuera de ella salteaba su
    // instrumentación y dejaba el request en vuelo (spec 2026-08-03 §2).
    //
    // El código de soporte que ve el usuario es siempre `fallbackTraceId`: el
    // trace de la fila que registra el fallo final. El trace del fallo del
    // proveedor viaja en los warnings para correlación interna, no en el
    // mensaje visible.
    const failFallback: (input: {
      errorCode: string
      provider?: CoachNormalizedResponse['provider']
      model?: string
      extraWarnings?: string[]
    }) => never = (input) => {
      useAIDebugStore.getState().failRequest(fallbackTraceId, {
        provider: input.provider,
        model: input.model,
        durationMs: Date.now() - fallbackStartedAt,
        retryUsed: providerAttempts > 1,
        fallbackUsed: true,
        errorCode: input.errorCode,
        outcome: 'schema_invalid',
        warnings: [
          buildWeekCreatorFallbackWarning(providerAttempts, lastFailure?.category),
          `Provider failure trace: ${failureTraceId}`,
          ...(input.extraWarnings ?? []),
        ],
        stageTimings: fallbackTracker.timings(),
      })
      fallbackTracker.flush('invalid_schema', { generationId, attempt: providerAttempts + 1 })
      throw new Error(`${failureMessage} Código de soporte: ${fallbackTraceId}.`)
    }

    const fallbackStage = fallbackTracker.stage('fallback')
    let fallback: CoachNormalizedResponse
    try {
      fallback = buildDeterministicWeekCreatorResponse({
        config,
        targetWeekStart: options.targetWeekStart,
        planningStartDate: dateWindow.planningStartDate,
        profile: context.athleteProfile ?? undefined,
        provider: lastFailure?.provider,
        error: failureMessage,
        traceId: fallbackTraceId,
      })
      fallbackStage.end({ ok: true })
    } catch (error) {
      // Causa cruda para el operador (consola + telemetría), nunca para el
      // usuario: `formatError` en useChatStore reexpone `Error.message` tal
      // cual en el chat.
      const cause = error instanceof Error ? error.message : String(error)
      fallbackStage.end({ ok: false, error: cause })
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[WeekCreatorEngine] fallback build failed', {
          traceId: fallbackTraceId,
          cause,
        })
      }
      failFallback({
        errorCode: 'fallback_build_failed',
        provider: lastFailure?.provider,
        model: lastFailure?.model,
        extraWarnings: [`Fallback build failed: ${cause}`],
      })
    }
    const fallbackValidateStage = fallbackTracker.stage('validate')
    const fallbackValidation = validateWeekCreatorResponse({
      response: fallback,
      context,
      config,
      targetWeekStart: options.targetWeekStart,
      planningStartDate: dateWindow.planningStartDate,
    })
    fallbackValidateStage.end({
      ok: fallbackValidation.ok && fallbackValidation.action != null,
      error: fallbackValidation.ok ? undefined : fallbackValidation.error,
    })
    if (!fallbackValidation.ok || !fallbackValidation.action) {
      failFallback({
        errorCode: 'fallback_invalid',
        provider: fallback.provider,
        model: fallback.model,
      })
    }
    const fallbackDurationMs = Date.now() - fallbackStartedAt
    useAIDebugStore.getState().completeRequest(fallback.traceId, {
      provider: fallback.provider,
      model: fallback.model,
      streamed: false,
      durationMs: fallbackDurationMs,
      retryUsed: providerAttempts > 1,
      fallbackUsed: true,
      errorCode: lastFailure?.code,
      outcome: lastFailure?.outcome ?? 'schema_invalid',
      warnings: [
        buildWeekCreatorFallbackWarning(providerAttempts, lastFailure?.category),
        ...(lastFailure?.warnings ?? []),
      ],
      stageTimings: fallbackTracker.timings(),
    })
    fallbackTracker.flush('ok', { generationId, attempt: providerAttempts + 1, fallbackUsed: true })
    return {
      ...fallback,
      durationMs: fallbackDurationMs,
      generationId,
      actions: [fallbackValidation.action],
      retryUsed: providerAttempts > 1,
      fallbackUsed: true,
      message: buildWeekCreatorFallbackMessage(fallbackValidation.action, lastFailure?.category),
    }
  },
}

function buildWeekCreatorCohort(
  context: ChatContext,
  config: WeekCreatorEffectiveConfig,
  targetWeekStart: string,
  planningStartDate: string,
): WeekCreatorCohort {
  const capacity = resolveScheduleCapacity(config)
  return {
    expectedSessionCount: config.sessionsPerWeek,
    trainingDayCount: capacity.trainingDays.length,
    allowedSportCount: config.allowedSports.length,
    doubleSessionAllowed: capacity.doubleSessionDays.length > 0,
    partialWeek: planningStartDate > targetWeekStart,
    activeRestrictionsPresent: hasActiveMedicalRestrictions(context, config),
  }
}

function buildInsufficientScheduleCapacityResponse(input: {
  generationId: string
  surface: AITechnicalSurface
  config: WeekCreatorEffectiveConfig
  cohort: WeekCreatorCohort
  availableSlots: number
}): CoachNormalizedResponse {
  const traceId = buildAITraceId('week_creator')
  const startedAt = Date.now()
  const tracker = createStageTracker(traceId, 'week_creator')
  useAIDebugStore.getState().startRequest({
    traceId,
    generationId: input.generationId,
    attempt: 1,
    requestClass: 'week_creator',
    surface: input.surface,
    startedAt,
    provider: 'mock',
    model: 'local-schedule-preflight',
    ...input.cohort,
  })
  const validationStage = tracker.stage('validate')
  const error = `La configuración solicita ${input.config.sessionsPerWeek} sesiones, pero sólo deja ${input.availableSlots} bloques AM/PM disponibles.`
  validationStage.end({ ok: false, error })
  const generationCompletedAt = Date.now()
  useAIDebugStore.getState().failRequest(traceId, {
    provider: 'mock',
    model: 'local-schedule-preflight',
    durationMs: generationCompletedAt - startedAt,
    outcome: 'schema_invalid',
    errorCode: 'insufficient_schedule_capacity',
    retryUsed: false,
    fallbackUsed: false,
    proposalCreated: false,
    generationOutcome: 'failed',
    generationCompletedAt,
    warnings: ['week_creator_failure:insufficient_schedule_capacity'],
    stageTimings: tracker.timings(),
  })
  tracker.flush('invalid_schema', {
    generationId: input.generationId,
    attempt: 1,
    fallbackReason: 'insufficient_schedule_capacity',
  })

  const sessionLabel = input.config.sessionsPerWeek === 1 ? 'sesión' : 'sesiones'
  const slotLabel = input.availableSlots === 1 ? 'bloque disponible' : 'bloques disponibles'
  return {
    message: `No puedo ubicar ${input.config.sessionsPerWeek} ${sessionLabel} respetando tu disponibilidad actual: hay ${input.availableSlots} ${slotLabel}. Agrega días o bloques AM/PM, o reduce la cantidad de sesiones, y vuelve a intentarlo.`,
    actions: [],
    provider: 'mock',
    model: 'local-schedule-preflight',
    timestamp: generationCompletedAt,
    durationMs: generationCompletedAt - startedAt,
    traceId,
    generationId: input.generationId,
    requestClass: 'week_creator',
    retryUsed: false,
    fallbackUsed: false,
    meta: {
      hadActionsMarkup: false,
      actionParseFailed: false,
      likelyTruncated: false,
      outcome: 'schema_invalid',
    },
  }
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (error instanceof Error) return error.name === 'AbortError'
  return false
}

// The old copy blamed the model for every fallback, including the common case
// where the provider answered fine and the week was rejected by local
// validation/hydration. Misattributing the cause sends the user to debug the
// wrong layer, so the message follows the failure category.
function buildWeekCreatorFallbackMessage(
  action: CoachAction,
  category?: WeekCreatorFailureCategory,
): string {
  const cause = category === 'provider_failure'
    ? 'no pude conectar con la IA'
    : 'la semana propuesta no pasó las validaciones de tu configuración'
  return `Generé una semana base automática porque ${cause}. Revísala antes de aplicarla.\n\n${summarizeWeekCreatorAction(action)}`
}

function buildWeekCreatorFallbackWarning(
  attempts: number,
  category?: WeekCreatorFailureCategory,
): string {
  return `week_creator_fallback:local attempts=${attempts} category=${category ?? 'unsafe_or_ambiguous'}`
}

function buildWeekCreatorUserFailureMessage(reason?: WeekCreatorFailureCode): string {
  if (reason === 'quality.squash.signature_uniqueness_unresolved') {
    return 'No pude garantizar que las sesiones de squash fueran distintas entre sí. Vuelve a intentarlo para generar otra candidata.'
  }
  if (reason === 'invalid_double_session' || reason === 'schedule_constraint' || reason === 'unavailable_day') {
    return 'No pude armar una semana que respete toda tu disponibilidad. Revisa los días y bloques AM/PM configurados, o reduce la cantidad de sesiones, y vuelve a intentarlo.'
  }
  return 'No pude armar una semana válida esta vez. Revisa tu configuración y vuelve a intentarlo.'
}

function buildWeekCreatorRepairFailureResponse(input: {
  generationId: string
  provider: CoachNormalizedResponse['provider']
  model?: string
  traceId: string
  durationMs?: number
  retryUsed: boolean
}): CoachNormalizedResponse {
  return {
    message: buildWeekCreatorUserFailureMessage('quality.squash.signature_uniqueness_unresolved'),
    actions: [],
    provider: input.provider,
    model: input.model,
    timestamp: Date.now(),
    durationMs: input.durationMs,
    traceId: input.traceId,
    generationId: input.generationId,
    requestClass: 'week_creator',
    retryUsed: input.retryUsed,
    fallbackUsed: false,
    meta: {
      hadActionsMarkup: true,
      actionParseFailed: false,
      likelyTruncated: false,
      outcome: 'quality_rejected',
    },
  }
}

type RepairedWeekCreatorResponse = CoachNormalizedResponse & {
  repairWarnings: string[]
  repairMeta?: RepairMeta
  repairFailure?: RepairFailure
  /** Skeleton-contract only: the hydration pass that ran before the final repair. */
  hydrationRepairMeta?: RepairMeta
}

/**
 * In the skeleton contract `repairGeneratedWeek` runs twice over the same
 * sessions — once to hydrate sport details, once as the final Week Creator
 * repair. Summing both passes would double-count every counter and inflate the
 * very telemetry Fase 3's exit criteria are read from, so the two passes stay
 * separate: `repairMeta` describes the week as delivered, `hydrationRepairMeta`
 * describes what hydration had to do to get there. Only warnings are unioned.
 */
function mergeWeekCreatorHydration(
  repaired: RepairedWeekCreatorResponse,
  hydration: WeekCreatorHydrationResult | undefined,
): RepairedWeekCreatorResponse {
  if (!hydration) return repaired

  const repairWarnings = [...new Set([
    ...hydration.warnings,
    ...repaired.repairWarnings,
  ])]
  const repairMeta = repaired.repairMeta && hydration.repairMeta
    ? { ...repaired.repairMeta, warnings: unionRepairWarnings(hydration.repairMeta, repaired.repairMeta) }
    : repaired.repairMeta ?? hydration.repairMeta

  return {
    ...repaired,
    repairWarnings,
    repairMeta,
    repairFailure: repaired.repairFailure ?? hydration.repairFailure,
    hydrationRepairMeta: hydration.repairMeta,
  }
}

function toRepairFailedWeekCreatorResponse(
  response: CoachNormalizedResponse,
  repairFailure: RepairFailure,
): RepairedWeekCreatorResponse {
  return {
    ...response,
    repairWarnings: [repairFailure.message],
    repairFailure,
  }
}

function unionRepairWarnings(
  hydration: RepairMeta,
  finalRepair: RepairMeta,
): RepairMeta['warnings'] {
  return [...hydration.warnings, ...finalRepair.warnings]
    .filter((warning, index, all) => all.findIndex((candidate) =>
      candidate.code === warning.code
      && candidate.message === warning.message
      && candidate.sessionDate === warning.sessionDate) === index)
}

export function repairWeekCreatorResponse(
  response: CoachNormalizedResponse,
  context: ChatContext,
  config: WeekCreatorEffectiveConfig,
  targetWeekStart: string,
  planningStartDate = targetWeekStart,
): RepairedWeekCreatorResponse {
  const actions = response.actions ?? []
  const createWeekActions = actions.filter((action) => action.type === 'create_week')
  if (createWeekActions.length !== 1) {
    return { ...response, repairWarnings: [] }
  }

  const action = createWeekActions[0]
  if (!Array.isArray(action.sessions) || action.sessions.length === 0) {
    return { ...response, repairWarnings: [] }
  }
  const targetDateNeedsRepair = action.targetDate !== targetWeekStart
  const targetDateRepairIsSafe = filterSessionsToWeek(action.sessions, targetWeekStart).length === action.sessions.length
    && action.sessions.every((session) => session.date >= planningStartDate)
  if (targetDateNeedsRepair && !targetDateRepairIsSafe) {
    return { ...response, repairWarnings: [] }
  }
  const actionRepairWarnings: RepairMeta['warnings'] = []
  if (actions.length > 1) {
    actionRepairWarnings.push({
      code: 'extra_actions_ignored',
      message: `Se ignoraron ${actions.length - 1} acción(es) accesoria(s) y se conservó la única semana completa.`,
    })
  }
  if (targetDateNeedsRepair) {
    actionRepairWarnings.push({
      code: 'target_date_repaired',
      message: `Se corrigió targetDate a la semana solicitada (${targetWeekStart}).`,
    })
  }

  const profile = buildRepairProfile(context)
  const aligned = alignSessionsToScheduleConstraints(action.sessions, config.scheduleConstraints)
  const repairConfig = buildScheduleAwareConfig(config)
  const repairContext = buildWeekCreatorHydrationRepairContext({
    context: { ...context, athleteProfile: profile },
    config: repairConfig,
    targetWeekStart,
    planningStartDate,
  })
  const repairResult = repairGeneratedWeek(aligned.sessions, repairContext)
  if (repairResult.failure) {
    return {
      ...response,
      repairWarnings: [repairResult.failure.message],
      repairMeta: repairResult.meta,
      repairFailure: repairResult.failure,
    }
  }
  if (aligned.adjustedCount > 0) {
    repairResult.meta.repairedSessionCount += aligned.adjustedCount
    for (const sessionKey of aligned.adjustedSessionKeys) {
      recordRepairAction(repairResult.meta.taxonomy, 'corrective', sessionKey)
    }
    repairResult.meta.warnings.push({
      code: 'schedule_time_block_adjusted',
      message: `Se ajustaron ${aligned.adjustedCount} sesión(es) a los bloques AM/PM configurados.`,
    })
  }
  const shouldFinalize = shouldFinalizeWeekCreatorSessions(repairResult.sessions, config)
  const finalizedSessions = shouldFinalize
    ? finalizeWeekCreatorSessions(repairResult.sessions, config, targetWeekStart, planningStartDate, profile)
    : repairResult.sessions
  const finalizedChanged = shouldFinalize && !areSessionListsEquivalent(repairResult.sessions, finalizedSessions)
  // Repair relocates by date without reading `scheduleConstraints`, so re-check
  // the AM/PM pinning it may have undone.
  const realigned = alignSessionsToScheduleConstraints(finalizedSessions, config.scheduleConstraints, { skipOccupied: true })
  if (realigned.adjustedCount > 0) {
    repairResult.meta.repairedSessionCount += realigned.adjustedCount
    for (const sessionKey of realigned.adjustedSessionKeys) {
      recordRepairAction(repairResult.meta.taxonomy, 'corrective', sessionKey)
    }
    repairResult.meta.warnings.push({
      code: 'schedule_time_block_adjusted',
      message: `Se ajustaron ${realigned.adjustedCount} sesión(es) a los bloques AM/PM configurados.`,
    })
  }
  repairResult.meta.warnings.push(...actionRepairWarnings)
  if (repairResult.meta.repairedSessionCount === 0
    && repairResult.meta.movedSessionCount === 0
    && repairResult.meta.addedFallbackCount === 0
    && repairResult.meta.droppedSessionCount === 0
    && repairResult.meta.filteredSportCount === 0
    && !finalizedChanged
    && actionRepairWarnings.length === 0
  ) {
    return { ...response, repairWarnings: [], repairMeta: repairResult.meta }
  }

  const repairedAction: CoachAction = {
    ...action,
    targetDate: targetWeekStart,
    sessions: realigned.sessions,
  }
  const repairWarnings = [
    ...repairResult.meta.warnings.map((warning) => warning.message),
    ...(finalizedChanged
      ? ['Se ajustó la distribución final de la semana para respetar cantidad, días y deportes de soporte.']
      : []),
  ]

  return {
    ...response,
    actions: [repairedAction],
    repairWarnings,
    repairMeta: repairResult.meta,
  }
}

function buildRawTelemetry(raw: AIRawResponse | undefined): Partial<AITechnicalResult> {
  if (!raw) return {}
  return {
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
  }
}

function buildRepairStats(
  meta: RepairMeta | undefined,
  hydrationMeta?: RepairMeta,
): AITechnicalResult['repairStats'] {
  if (!meta) return undefined
  return {
    repairedSessionCount: meta.repairedSessionCount,
    movedSessionCount: meta.movedSessionCount,
    addedFallbackCount: meta.addedFallbackCount,
    droppedSessionCount: meta.droppedSessionCount,
    filteredSportCount: meta.filteredSportCount,
    repairTaxonomyVersion: 2,
    ...summarizeTaxonomy(meta.taxonomy),
    codes: [...new Set(meta.warnings.map((warning) => warning.code))],
    ...(hydrationMeta
      ? {
          hydration: {
            repairedSessionCount: hydrationMeta.repairedSessionCount,
            movedSessionCount: hydrationMeta.movedSessionCount,
            addedFallbackCount: hydrationMeta.addedFallbackCount,
            droppedSessionCount: hydrationMeta.droppedSessionCount,
            filteredSportCount: hydrationMeta.filteredSportCount,
            repairTaxonomyVersion: 2,
            ...summarizeTaxonomy(hydrationMeta.taxonomy),
          },
        }
      : {}),
  }
}

function shouldFinalizeWeekCreatorSessions(
  sessions: CoachSessionProposal[],
  config: WeekCreatorEffectiveConfig,
): boolean {
  const expected = Math.max(1, config.sessionsPerWeek)
  if (sessions.length !== expected) return true

  const allowedSports = new Set<SupportedSport>([...(config.allowedSports.length > 0 ? config.allowedSports : []), 'mobility'])
  if (allowedSports.size > 0 && sessions.some((session) => !allowedSports.has(session.sessionType as SupportedSport))) return true

  const primary = config.primarySport ?? config.allowedSports[0]
  if (primary !== 'squash' || expected < 4) return false

  const supportSports = config.allowedSports.filter((sport) => sport !== primary)
  if (supportSports.length === 0) return false

  const primaryTarget = getFallbackPrimaryTarget(config, primary, expected, true)
  const primaryCount = sessions.filter((session) => session.sessionType === primary).length
  if (primaryCount < primaryTarget) return true

  const supportSlots = Math.max(0, expected - primaryTarget)
  if (supportSlots === 0) return false

  const presentSupportSports = new Set(
    sessions
      .map((session) => session.sessionType as SupportedSport)
      .filter((sport) => sport !== primary && supportSports.includes(sport)),
  )
  if (supportSlots === 1) return presentSupportSports.size === 0

  const requiredSupportSports = supportSports.slice(0, supportSlots)
  return requiredSupportSports.some((sport) => !presentSupportSports.has(sport))
}

function finalizeWeekCreatorSessions(
  sessions: CoachSessionProposal[],
  config: WeekCreatorEffectiveConfig,
  targetWeekStart: string,
  planningStartDate = targetWeekStart,
  profile?: AthleteProfile,
): CoachSessionProposal[] {
  const expected = Math.max(1, config.sessionsPerWeek)
  const targetSports = buildFallbackSportSequence(config).slice(0, expected)
  const slots = buildFallbackSlots(config, targetWeekStart, expected, planningStartDate)
  if (targetSports.length === 0 || slots.length < expected) return sessions
  const scheduledSports = assignFallbackSportsToSlots(targetSports, slots)

  const allowedSports = new Set<SupportedSport>([...(config.allowedSports.length > 0 ? config.allowedSports : targetSports), 'mobility'])
  const remaining = sessions
    .filter((session) => allowedSports.has(session.sessionType as SupportedSport))
    .map((session) => ({ ...session }))
  const sportCounts = new Map<SupportedSport, number>()

  const finalized = scheduledSports.map((sport, index) => {
    const existingIndex = remaining.findIndex((session) => session.sessionType === sport)
    const slot = slots[index]
    const sportIndex = sportCounts.get(sport) ?? 0
    sportCounts.set(sport, sportIndex + 1)

    const session = existingIndex >= 0
      ? remaining.splice(existingIndex, 1)[0]
      : buildFallbackSession(sport, slot.date, slot.timeBlock, config.sessionDurationMins, sportIndex, config, profile)

    return {
      ...session,
      date: slot.date,
      timeBlock: slot.timeBlock,
    }
  })

  return finalized.sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

export function areSessionListsEquivalent(
  a: CoachSessionProposal[],
  b: CoachSessionProposal[],
): boolean {
  if (a.length !== b.length) return false
  return a.every((session, index) => {
    const other = b[index]
    return other != null
      && session.date === other.date
      && session.timeBlock === other.timeBlock
      && session.sessionType === other.sessionType
      && session.title === other.title
      && sessionContentSignature(session) === sessionContentSignature(other)
  })
}

/**
 * Captures the parts of a session that finalize/fallback can rewrite without
 * touching date/timeBlock/sessionType/title (objective, strength exercises,
 * squash drills). Without it, a content-only change would be reported as "no
 * change" and the finalized sessions could be silently discarded.
 */
function sessionContentSignature(session: CoachSessionProposal): string {
  const exercises = Array.isArray(session.exercises)
    ? session.exercises
        .map((exercise) => `${exercise.name}|${exercise.sets}|${String(exercise.reps)}|${exercise.group ?? ''}`)
        .join(',')
    : ''
  const drills = squashDrillNames(session).join(',')
  return `${session.objective ?? ''}::${exercises}::${drills}`
}

function squashDrillNames(session: CoachSessionProposal): string[] {
  const details = session.squashDetails
  if (!details) return []
  return [
    ...(Array.isArray(details.drills) ? details.drills : []),
    ...(Array.isArray(details.blocks)
      ? details.blocks.flatMap((block) => (Array.isArray(block.drills) ? block.drills : []))
      : []),
  ].map((drill) => drill.name)
}

function buildRepairProfile(context: ChatContext): AthleteProfile {
  if (context.athleteProfile) return context.athleteProfile
  return {
    id: 'week-creator-profile',
    updatedAt: Date.now(),
  }
}

function addDaysIso(date: string, days: number): string {
  const start = new Date(`${date}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() + days)
  return start.toISOString().slice(0, 10)
}

function buildDeterministicWeekCreatorResponse(input: {
  config: WeekCreatorEffectiveConfig
  targetWeekStart: string
  planningStartDate?: string
  profile?: AthleteProfile
  provider?: CoachNormalizedResponse['provider']
  error?: string
  traceId?: string
}): CoachNormalizedResponse {
  const action: CoachAction = {
    type: 'create_week',
    reason: 'Semana base generada con tu configuración actual para que puedas revisarla y ajustarla antes de aplicarla.',
    targetDate: input.targetWeekStart,
    weekObjectives: [
      'Mantener continuidad con carga controlada.',
      'Priorizar el deporte principal sin perder soporte complementario.',
      'Dejar una semana ejecutable y fácil de ajustar.',
    ],
    sessions: buildDeterministicSessions(input.config, input.targetWeekStart, input.planningStartDate ?? input.targetWeekStart, input.profile),
  }

  return {
    message: summarizeWeekCreatorAction(action),
    actions: [action],
    provider: 'mock',
    model: 'local-week-fallback',
    timestamp: Date.now(),
    durationMs: 0,
    traceId: input.traceId ?? buildAITraceId('week_creator'),
    requestClass: 'week_creator',
    retryUsed: false,
    fallbackUsed: true,
    raw: input.error ? { fallbackReason: input.error } : undefined,
    meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false, outcome: 'ok' },
  }
}

function buildDeterministicSessions(
  config: WeekCreatorEffectiveConfig,
  targetWeekStart: string,
  planningStartDate = targetWeekStart,
  profile?: AthleteProfile,
): CoachSessionProposal[] {
  const sportSequence = buildFallbackSportSequence(config)
  const plannedSlots = buildFallbackSlots(config, targetWeekStart, sportSequence.length, planningStartDate)
  const scheduledSports = assignFallbackSportsToSlots(sportSequence, plannedSlots)
  const sportCounts = new Map<SupportedSport, number>()

  return plannedSlots.map((slot, index) => {
    const sport = scheduledSports[index]
    const sportIndex = sportCounts.get(sport) ?? 0
    sportCounts.set(sport, sportIndex + 1)
    return buildFallbackSession(sport, slot.date, slot.timeBlock, config.sessionDurationMins, sportIndex, config, profile)
  })
}

function buildFallbackSportSequence(config: WeekCreatorEffectiveConfig): SupportedSport[] {
  const primary = config.primarySport ?? config.allowedSports[0] ?? 'squash'
  const allowed = uniqueSports([primary, ...config.allowedSports])
  const supportSports = allowed.filter((sport) => sport !== primary)
  const total = Math.max(1, config.sessionsPerWeek)
  const primaryTarget = getFallbackPrimaryTarget(config, primary, total, supportSports.length > 0)
  const sequence: SupportedSport[] = []
  let primaryCount = 0
  let supportIndex = 0

  for (let index = 0; index < total; index++) {
    const remainingSlots = total - index
    const remainingPrimary = primaryTarget - primaryCount
    const mustUsePrimary = remainingPrimary >= remainingSlots
    const shouldUsePrimary = primaryCount < primaryTarget && (index % 2 === 0 || supportSports.length === 0)
    if (mustUsePrimary || shouldUsePrimary) {
      sequence.push(primary)
      primaryCount += 1
      continue
    }

    sequence.push(supportSports[supportIndex % supportSports.length] ?? primary)
    supportIndex += 1
  }

  return sequence
}

function getFallbackPrimaryTarget(
  config: WeekCreatorEffectiveConfig,
  primary: SupportedSport,
  total: number,
  hasSupportSports: boolean,
): number {
  const majorityTarget = primary === 'squash' && total >= 4
    ? Math.floor(total / 2) + 1
    : Math.min(total, Math.max(1, Math.ceil(total / 2)))

  if (!hasSupportSports) return majorityTarget

  // If capacity comes from double sessions across only a few days, avoid
  // forcing the same primary sport twice on one date. A squash+strength day is
  // much more useful than squash+squash when we are in local fallback mode.
  const perDayPrimaryCap = Math.max(1, resolveScheduleCapacity(config).trainingDays.length)
  return Math.min(majorityTarget, perDayPrimaryCap)
}

function uniqueSports(sports: SupportedSport[]): SupportedSport[] {
  return sports.filter((sport, index) => sports.indexOf(sport) === index)
}

function assignFallbackSportsToSlots(
  sports: SupportedSport[],
  slots: Array<{ date: string; timeBlock: TimeBlock }>,
): SupportedSport[] {
  const assigned = sports.slice(0, slots.length)
  for (let index = 0; index < assigned.length; index++) {
    if (assigned[index] !== 'squash') continue
    const date = slots[index]?.date
    const duplicatesSquash = assigned.some((sport, otherIndex) =>
      otherIndex < index && sport === 'squash' && slots[otherIndex]?.date === date)
    if (!duplicatesSquash) continue

    const swapIndex = assigned.findIndex((sport, candidateIndex) => {
      if (sport === 'squash' || candidateIndex === index) return false
      const candidateDate = slots[candidateIndex]?.date
      if (!candidateDate || candidateDate === date) return false
      return !assigned.some((candidateSport, otherIndex) =>
        otherIndex !== candidateIndex
        && candidateSport === 'squash'
        && slots[otherIndex]?.date === candidateDate)
    })
    if (swapIndex < 0) continue
    const swapSport = assigned[swapIndex]
    assigned[swapIndex] = assigned[index]
    assigned[index] = swapSport
  }
  return assigned
}

function buildFallbackSlots(
  config: WeekCreatorEffectiveConfig,
  targetWeekStart: string,
  count: number,
  planningStartDate = targetWeekStart,
): Array<{ date: string; timeBlock: TimeBlock }> {
  const fallbackDays: DayOfWeek[] = ['monday', 'wednesday', 'friday']
  const capacity = resolveScheduleCapacity({
    ...config,
    trainingDays: config.trainingDays.length > 0 ? config.trainingDays : fallbackDays,
  })
  const dates = capacity.trainingDays
    .map((day) => addDaysIso(targetWeekStart, dayOffset(day)))
    .filter((date) => date >= planningStartDate)
    .sort()
  const slots: Array<{ date: string; timeBlock: TimeBlock }> = []

  for (const date of dates) {
    const day = dayOfWeekFromTargetDate(targetWeekStart, date)
    const constraint = day ? resolveDayScheduleConstraint(config.scheduleConstraints, day) : undefined
    slots.push({ date, timeBlock: constraint === 'PM' ? 'PM' : 'AM' })
  }

  const doubleDaySet = new Set(capacity.doubleSessionDays)
  for (const date of dates) {
    const day = dayOfWeekFromTargetDate(targetWeekStart, date)
    if (!day || !doubleDaySet.has(day)) continue
    slots.push({ date, timeBlock: 'PM' })
  }

  return slots.slice(0, count)
}

function dayOfWeekFromTargetDate(_targetWeekStart: string, date: string): DayOfWeek | null {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  const mapping: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return mapping[weekday] ?? null
}

// Offsets assume targetWeekStart is a Monday (the only value the chat router
// produces via startOfWeek(..., { weekStartsOn: 1 })). The AI path validates
// against the real weekday, so this hard-coded origin only feeds the
// deterministic fallback builder; revisit if a non-Monday week start is ever
// introduced upstream.
function dayOffset(day: DayOfWeek): number {
  const offsets: Record<DayOfWeek, number> = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4,
    saturday: 5,
    sunday: 6,
  }
  return offsets[day]
}

/**
 * Identidad por `id` para los fallbacks locales de fuerza del Week Creator:
 * evita repetir nombre visible y `libraryRef` a mano en cada fila, así un
 * renombre futuro del catálogo no vuelve a desincronizar productor y
 * definición (spec 2026-08-01 §3).
 */
function fallbackStrengthExercise(
  id: string,
  prescription: Omit<CoachExerciseProposal, 'name' | 'libraryRef'>,
): CoachExerciseProposal {
  return { ...getStrengthExerciseIdentityById(id), ...prescription }
}

function buildFallbackSession(
  sport: SupportedSport,
  date: string,
  timeBlock: TimeBlock,
  baseDurationMin: number,
  index: number,
  config: WeekCreatorEffectiveConfig,
  profile?: AthleteProfile,
): CoachSessionProposal {
  const durationMin = sport === 'mobility' ? Math.min(40, baseDurationMin) : baseDurationMin
  const base = {
    date,
    timeBlock,
    sessionType: sport,
    durationMin,
    rpe: sport === 'mobility' ? 3 : sport === 'strength' ? 6 : 5,
  }

  if (sport === 'running') {
    return {
      ...base,
      title: 'Rodaje Z2 controlado',
      objective: 'Sumar carga aeróbica sin interferir con el deporte principal.',
      runningType: 'z2',
      targetHrMin: 130,
      targetHrMax: 150,
    }
  }

  if (sport === 'strength') {
    const includeSpecificCardio =
      config.primarySport === 'squash' &&
      durationMin >= 55 &&
      config.currentFatigue !== 'overloaded'
    const variants: CoachExerciseProposal[][] = [
      [
        fallbackStrengthExercise('dead_bug', { sets: 3, reps: '8/lado', group: 'core' }),
        fallbackStrengthExercise('side_plank', { sets: 3, reps: '30s/lado', group: 'core' }),
        fallbackStrengthExercise('goblet_squat', { sets: 3, reps: 8, group: 'legs' }),
        fallbackStrengthExercise('chest_supported_row', { sets: 3, reps: 10, group: 'pull' }),
        fallbackStrengthExercise('overhead_press', { sets: 3, reps: '8/lado', group: 'push' }),
        fallbackStrengthExercise('bb_side_lunge', { sets: 3, reps: '8/lado', group: 'legs' }),
        ...(includeSpecificCardio
          ? [fallbackStrengthExercise('assault_bike_30_30', { sets: 1, reps: '4 min: 30s fuerte / 30s suave', group: 'cardio' })]
          : []),
      ],
      [
        fallbackStrengthExercise('dead_bug', { sets: 3, reps: '8/lado', group: 'core' }),
        fallbackStrengthExercise('pallof_press', { sets: 3, reps: '10/lado', group: 'core' }),
        fallbackStrengthExercise('romanian_deadlift', { sets: 3, reps: 8, group: 'legs' }),
        fallbackStrengthExercise('incline_dumbbell_press', { sets: 3, reps: 8, group: 'push' }),
        fallbackStrengthExercise('inverted_row', { sets: 3, reps: 10, group: 'pull' }),
        fallbackStrengthExercise('split_squat', { sets: 3, reps: '8/lado', group: 'legs' }),
        ...(includeSpecificCardio
          ? [fallbackStrengthExercise('air_treadmill_20_20', { sets: 1, reps: '4 min: 20s fuerte / 20s suave', group: 'cardio' })]
          : []),
      ],
    ]
    return {
      ...base,
      title: index % 2 === 0 ? 'Fuerza base tren inferior' : 'Fuerza soporte torso',
      objective: 'Construir soporte general con fatiga controlada.',
      exercises: enhanceStrengthSessionExercises(variants[index % variants.length], {
        durationMin,
        strengthProfile: profile?.strengthProfile,
      }),
    }
  }

  if (sport === 'cycling') {
    return {
      ...base,
      title: 'Ciclismo Z2 suave',
      objective: 'Base aeróbica de baja interferencia.',
      cyclingDetails: {
        sessionCategory: 'support aerobic',
        sessionFamily: 'z2_aerobic',
        targetStructure: `${durationMin}min continuos en Z2, cadencia cómoda.`,
        intensityReference: 'low',
        executionNotes: 'Mantén sensación conversacional y evita cerrar fuerte.',
      },
    }
  }

  if (sport === 'mobility') {
    return {
      ...base,
      title: 'Movilidad restaurativa',
      objective: 'Liberar cadera, columna y tobillo para sostener la semana.',
      exercises: [
        { name: '90/90 de cadera', sets: 2, reps: '60s/lado', group: 'mobility', mobilityFocus: 'hip' },
        { name: 'Rotación torácica', sets: 2, reps: '8/lado', group: 'mobility', mobilityFocus: 'spine' },
        { name: 'Movilidad de tobillo', sets: 2, reps: '10/lado', group: 'mobility', mobilityFocus: 'ankle' },
      ],
      mobilityDetails: {
        focusAreas: ['hip', 'spine', 'ankle'],
        context: 'full_body',
        targetStructure: `${durationMin}min de movilidad continua, sin dolor y con respiración nasal.`,
        executionNotes: 'Usa rango cómodo; debe dejarte mejor, no cansado.',
      },
    }
  }

  const squashVariants: SquashFallbackVariant[] = [
    {
      title: 'Squash técnico de profundidad',
      trainingFocus: 'technical' as const,
      sessionKind: 'technical' as const,
      sessionMode: 'drill_session',
      objective: 'Construir profundidad, dirección y salida técnica sin exceder la carga.',
      blocks: [{
        kind: 'technical',
        drills: [
          drill('Drives paralelos profundos', 12),
          drill('Drives cruzados profundos', 12),
          drill('Alternar drive paralelo y cruzado', 12),
          drill('Peloteo profundo suave de recuperación', 10),
        ],
        durationMin: 46,
      }],
    },
    {
      title: 'Squash ghosting + control',
      trainingFocus: 'physical',
      sessionKind: 'mixed',
      sessionMode: 'drill_session',
      objective: 'Ordenar pies y vuelta a la T, luego estabilizar control de pelota.',
      blocks: [
        {
          kind: 'shadows',
          drills: [
            drill('Ghosting a cuatro esquinas', 10),
            drill('Split-step y vuelta a la T', 10),
          ],
          durationMin: 20,
        },
        {
          kind: 'control',
          drills: [
            drill('Drives desde media cancha — 100', 10),
            drill('Drives al cuadro de saque — 100', 10),
            drill('Drops en solitario — 100 (50 por lado)', 8),
          ],
          durationMin: 28,
        },
      ],
    },
    {
      title: 'Squash mixto técnico + juegos',
      trainingFocus: 'conditioned_games',
      sessionKind: 'mixed',
      sessionMode: 'practice_match',
      objective: 'Transferir técnica a puntos condicionados y cerrar con games cortos.',
      blocks: [
        {
          kind: 'technical',
          drills: [
            drill('Drives paralelos profundos', 10),
            drill('Alternar drive paralelo y cruzado', 10),
          ],
          durationMin: 20,
        },
        {
          kind: 'control',
          drills: [
            drill('Juego condicionado solo paralelo', 10),
            drill('Juego condicionado solo al fondo', 10),
          ],
          durationMin: 20,
        },
        {
          kind: 'match',
          drills: [
            drill('Game a 11 con marcador real', 12),
          ],
          durationMin: 12,
        },
      ],
    },
    {
      title: 'Squash técnico de manos y frente',
      trainingFocus: 'technical',
      sessionKind: 'technical',
      sessionMode: 'drill_session',
      objective: 'Mejorar tacto, preparación y precisión en media cancha/frente con baja interferencia.',
      blocks: [{
        kind: 'technical',
        drills: [
          drill('Drops desde media cancha', 12),
          drill('Drop y contra-drop por ambos lados', 10),
          drill('Volea de control desde media cancha', 12),
          drill('Boast y salida con drive paralelo', 12),
        ],
        durationMin: 46,
      }],
    },
    {
      title: 'Squash presión controlada',
      trainingFocus: 'conditioned_games',
      sessionKind: 'mixed',
      sessionMode: 'practice_match',
      objective: 'Practicar presión desde largo y media cancha con cierre en puntos cortos.',
      blocks: [
        {
          kind: 'technical',
          drills: [
            drill('Presión a esquinas de fondo', 10),
            drill('Ataque antes del fondo', 10),
          ],
          durationMin: 20,
        },
        {
          kind: 'control',
          drills: [
            drill('Juego condicionado solo al fondo', 10),
            drill('Juego condicionado en media cancha', 10),
          ],
          durationMin: 20,
        },
        {
          kind: 'match',
          drills: [
            drill('Partido de entrenamiento al mejor de 3 juegos', 12),
          ],
          durationMin: 12,
        },
      ],
    },
    {
      title: 'Squash voleas, transición y games',
      trainingFocus: 'conditioned_games',
      sessionKind: 'mixed',
      sessionMode: 'practice_match',
      objective: 'Conectar voleas y transición frente-fondo con aplicación en juegos sueltos.',
      blocks: [
        {
          kind: 'technical',
          drills: [
            drill('Volea de control desde media cancha', 10),
            drill('Transición frente-fondo con vuelta a la T', 10),
          ],
          durationMin: 20,
        },
        {
          kind: 'control',
          drills: [
            drill('Patrón largo-corto desde la T', 10),
            drill('Juego condicionado con zona prohibida', 10),
          ],
          durationMin: 20,
        },
        {
          kind: 'match',
          drills: [
            drill('Game a 11 con marcador real', 12),
          ],
          durationMin: 12,
        },
      ],
    },
  ]
  const variant = squashVariants[index % squashVariants.length]
  const drills = flattenSquashBlocks(variant.blocks)

  return {
    ...base,
    sessionType: 'squash',
    title: variant.title,
    objective: variant.objective,
    subtype: 'training',
    squashDetails: {
      trainingFocus: variant.trainingFocus,
      sessionMode: variant.sessionMode,
      sessionKind: variant.sessionKind,
      drills,
      blocks: variant.blocks,
    },
  }
}

function drill(name: string, durationMin: number, notes?: string): SquashDrill {
  return notes ? { name, durationMin, notes } : { name, durationMin }
}

function flattenSquashBlocks(blocks: SquashSessionBlock[]): SquashDrill[] {
  return blocks.flatMap((block) => block.drills)
}
