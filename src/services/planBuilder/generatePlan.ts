import type { AIProvider } from '../ai/types'
import { getProviderForRequestClass } from '../ai/providerResolver'
import type { AthleteProfile, CoachAction, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { buildAITraceId, getAIRequestPolicy } from '../ai/requestPolicy'
import { normalizeResponse } from '../ai/responseNormalizer'
import { assertDailyAIRequestLimit } from '../ai/aiTelemetry'
import { useAIDebugStore } from '../../store/useAIDebugStore'
import {
  generateWeek,
  summarizeWeekGenerationError,
  validateGeneratedWeekAction,
} from './generateWeek'
import { buildWeekBatchStructuredSystemPromptMinimal, buildWeekBatchUserPrompt } from '../week/prompts/weekPrompt'
import { createStreamingActionsParser } from '../week/streamingActionsParser'
import {
  buildWeekRetryInstruction,
  filterSessionsToWeek,
  pickCreateWeekDiagnostic,
} from '../week/shared'
import { resolveConfiguredGenerationStrategy } from './generationState'
import { getExpectedSessionsForPlanWeek } from './dateRange'
import { buildLocalFallbackWeek } from './fallbackWeek'
import { PLAN_BUILDER_PAIR_RESPONSE_SCHEMA } from './planBuilderResponseSchema'

const MAX_SINGLE_WEEK_PROVIDER_ATTEMPTS = 2

export interface GeneratePlanWeeksInput {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  provider?: AIProvider
  onWeekUpdate?: (week: TrainingPlanWeek) => void
  onChunk?: (weekIndex: number, chunk: string) => void
  abortSignal?: AbortSignal
  seedPreviousWeek?: TrainingPlanWeek
  strategy?: 'single' | 'pairs'
}

interface BatchWeekExtraction {
  week: TrainingPlanWeek
  sessions: TrainingPlanWeek['sessions']
  error?: string
  rawSessionCount?: number
  validSessionCount?: number
  droppedSessionCount?: number
  repairedSessionCount?: number
  movedSessionCount?: number
  addedFallbackCount?: number
  filteredSportCount?: number
  repairWarnings?: Array<{ code: string; message: string }>
}

interface WeekBatchChunkRouter {
  push: (chunk: string) => void
}

function createBatchId(firstWeekIndex: number): string {
  return `batch-${firstWeekIndex}-${Date.now()}`
}

function createWeekBatchChunkRouter(
  weeks: [TrainingPlanWeek, TrainingPlanWeek],
  onChunk: ((weekIndex: number, chunk: string) => void) | undefined,
): WeekBatchChunkRouter {
  let streamedText = ''
  let deliveredLength = 0

  const targetDatePattern = /"targetDate"\s*:\s*"([^"]+)"/g

  return {
    push(chunk: string) {
      streamedText += chunk

      let activeWeekIndex: number | undefined
      for (const match of streamedText.matchAll(targetDatePattern)) {
        const matchedWeek = weeks.find((week) => week.weekStartDate === match[1])
        if (matchedWeek) {
          activeWeekIndex = matchedWeek.weekIndex
        }
      }

      if (activeWeekIndex == null || streamedText.length <= deliveredLength) return

      onChunk?.(activeWeekIndex, streamedText.slice(deliveredLength))
      deliveredLength = streamedText.length
    },
  }
}

function resolveStrategy(input: GeneratePlanWeeksInput): 'single' | 'pairs' {
  return resolveConfiguredGenerationStrategy(input.plan.totalWeeks, input.strategy)
}

function makeGeneratingWeek(
  week: TrainingPlanWeek,
  strategy: 'single' | 'pairs',
  batchId?: string,
): TrainingPlanWeek {
  return {
    ...week,
    status: 'generating',
    generationMeta: {
      ...week.generationMeta,
      strategy,
      batchId,
    },
    updatedAt: Date.now(),
  }
}

function makeResolvedWeek(
  week: TrainingPlanWeek,
  sessions: TrainingPlanWeek['sessions'],
  input: {
    attempts: number
    provider: string
    model?: string
    requestClass?: 'plan_builder_week' | 'plan_builder_pair'
    traceId?: string
    lastError?: string
    durationMs?: number
    chunkCount?: number
    retryUsed?: boolean
    fallbackUsed?: boolean
    strategy: 'single' | 'pairs'
    batchId?: string
    rawSessionCount?: number
    validSessionCount?: number
    droppedSessionCount?: number
    degradedFromPairs?: boolean
    repairedSessionCount?: number
    movedSessionCount?: number
    addedFallbackCount?: number
    filteredSportCount?: number
    repairWarnings?: Array<{ code: string; message: string }>
    stageTimings?: Array<{ stage: string; durationMs: number; ok: boolean; error?: string }>
    errorClass?: string
  },
): TrainingPlanWeek {
  const nowTs = Date.now()
  return {
    ...week,
    status: sessions.length > 0 ? 'draft' : 'error',
    sessions,
    generationMeta: {
      ...week.generationMeta,
      attempts: (week.generationMeta.attempts ?? 0) + input.attempts,
      provider: input.provider,
      model: input.model,
      requestClass: input.requestClass,
      traceId: input.traceId,
      lastError: input.lastError,
      lastAttemptAt: nowTs,
      durationMs: input.durationMs,
      chunkCount: input.chunkCount,
      retryUsed: input.retryUsed,
      fallbackUsed: input.fallbackUsed,
      strategy: input.strategy,
      batchId: input.batchId,
      rawSessionCount: input.rawSessionCount,
      validSessionCount: input.validSessionCount,
      droppedSessionCount: input.droppedSessionCount,
      degradedFromPairs: input.degradedFromPairs,
      repairedSessionCount: input.repairedSessionCount,
      movedSessionCount: input.movedSessionCount,
      addedFallbackCount: input.addedFallbackCount,
      filteredSportCount: input.filteredSportCount,
      repairWarnings: input.repairWarnings,
      stageTimings: input.stageTimings,
      errorClass: input.errorClass,
    },
    updatedAt: nowTs,
  }
}

function makeLocalFallbackResolvedWeek(input: {
  plan: TrainingPlan
  week: TrainingPlanWeek
  previousWeek?: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  attempts: number
  provider: string
  model?: string
  requestClass?: 'plan_builder_week' | 'plan_builder_pair'
  traceId?: string
  lastError?: string
  durationMs?: number
  chunkCount?: number
  strategy: 'single' | 'pairs'
  batchId?: string
  rawSessionCount?: number
  droppedSessionCount?: number
  degradedFromPairs?: boolean
}): TrainingPlanWeek {
  const fallback = buildLocalFallbackWeek({
    plan: input.plan,
    week: input.week,
    previousWeek: input.previousWeek,
    profile: input.profile,
    wizardConfig: input.wizardConfig,
  })

  if (fallback.sessions.length === 0) {
    return makeResolvedWeek(input.week, [], {
      attempts: input.attempts,
      provider: input.provider,
      model: input.model,
      requestClass: input.requestClass,
      traceId: input.traceId,
      lastError: input.lastError,
      durationMs: input.durationMs,
      chunkCount: input.chunkCount,
      strategy: input.strategy,
      batchId: input.batchId,
      rawSessionCount: input.rawSessionCount,
      droppedSessionCount: input.droppedSessionCount,
      degradedFromPairs: input.degradedFromPairs,
    })
  }

  return makeResolvedWeek(input.week, fallback.sessions, {
    attempts: input.attempts,
    provider: input.provider,
    model: input.model ? `${input.model}+local-plan-fallback` : 'local-plan-fallback',
    requestClass: input.requestClass,
    traceId: input.traceId,
    lastError: input.lastError,
    durationMs: input.durationMs,
    chunkCount: input.chunkCount,
    fallbackUsed: true,
    strategy: input.strategy,
    batchId: input.batchId,
    rawSessionCount: input.rawSessionCount ?? 0,
    validSessionCount: fallback.sessions.length,
    droppedSessionCount: input.droppedSessionCount ?? 0,
    degradedFromPairs: input.degradedFromPairs,
    repairedSessionCount: fallback.meta.repairedSessionCount,
    movedSessionCount: fallback.meta.movedSessionCount,
    addedFallbackCount: fallback.meta.addedFallbackCount,
    filteredSportCount: fallback.meta.filteredSportCount,
    repairWarnings: [
      { code: 'local_plan_fallback', message: `Se generó una semana base local después de ${input.attempts} intento(s) fallidos del proveedor.` },
      ...fallback.meta.warnings,
    ],
    errorClass: 'local_plan_fallback',
  })
}

function normalizeRetryInstruction(
  error: string | undefined,
  plan: TrainingPlan,
  week: TrainingPlanWeek,
  expectedSessions: number,
  attempt: number,
): string | undefined {
  if (attempt <= 1) return undefined
  const base = summarizeWeekGenerationError(error, week, plan)
  return buildWeekRetryInstruction(base, week.weekStartDate, expectedSessions, attempt)
    ?? `${base} Usa formato estricto: targetDate=${week.weekStartDate}, sesiones compactas y todas las fechas dentro de esa semana.`
}

export async function generateSingleWeekWithRetry(
  provider: AIProvider,
  plan: TrainingPlan,
  week: TrainingPlanWeek,
  previousWeek: TrainingPlanWeek | undefined,
  profile: AthleteProfile,
  wizardConfig: PlanWizardConfig,
  onChunk: ((weekIndex: number, chunk: string) => void) | undefined,
): Promise<TrainingPlanWeek> {
  let attempts = 0
  let lastError: string | undefined
  let providerName = provider.name
  let model: string | undefined
  let durationMs = 0
  let chunkCount = 0
  let rawSessionCount: number | undefined
  let droppedSessionCount: number | undefined

  for (let attempt = 1; attempt <= MAX_SINGLE_WEEK_PROVIDER_ATTEMPTS; attempt++) {
    const result = await generateWeek({
      provider,
      plan,
      week,
      previousWeek,
      profile,
      wizardConfig,
      temperature: attempt === 1 ? 0.4 : 0.25,
      retryInstruction: normalizeRetryInstruction(lastError, plan, week, getExpectedSessionsForPlanWeek(plan, week), attempt),
      strictFormatting: attempt >= 3,
      onChunk: (chunk) => onChunk?.(week.weekIndex, chunk),
    })
    attempts += result.meta.attempts
    lastError = result.meta.lastError
    providerName = result.meta.provider
    model = result.meta.model
    durationMs += result.meta.durationMs ?? 0
    chunkCount += result.meta.chunkCount ?? 0
    rawSessionCount = result.meta.rawSessionCount
    droppedSessionCount = result.meta.droppedSessionCount

    if (result.sessions.length > 0) {
      return makeResolvedWeek(week, result.sessions, {
        attempts,
        provider: providerName,
        model,
        requestClass: 'plan_builder_week',
        durationMs,
        chunkCount,
        strategy: 'single',
        rawSessionCount: result.meta.rawSessionCount,
        validSessionCount: result.meta.validSessionCount,
        droppedSessionCount: result.meta.droppedSessionCount,
        repairedSessionCount: result.meta.repairedSessionCount,
        movedSessionCount: result.meta.movedSessionCount,
        addedFallbackCount: result.meta.addedFallbackCount,
        filteredSportCount: result.meta.filteredSportCount,
        repairWarnings: result.meta.repairWarnings,
        stageTimings: result.meta.stageTimings,
        errorClass: result.meta.errorClass,
      })
    }

    if (result.meta.errorClass === 'rate_limit') {
      break
    }
  }

  return makeLocalFallbackResolvedWeek({
    plan,
    week,
    previousWeek,
    profile,
    wizardConfig,
    attempts,
    provider: providerName,
    model,
    requestClass: 'plan_builder_week',
    lastError,
    durationMs,
    chunkCount,
    strategy: 'single',
    rawSessionCount,
    droppedSessionCount,
  })
}

function getActionTargetWeekStart(action: CoachAction, requestedWeeks: [TrainingPlanWeek, TrainingPlanWeek]): string | undefined {
  if (action.targetDate && requestedWeeks.some((week) => week.weekStartDate === action.targetDate)) {
    return action.targetDate
  }

  const matchedWeek = requestedWeeks.find((week) => {
    if (!Array.isArray(action.sessions) || action.sessions.length === 0) return false
    const filtered = filterSessionsToWeek(action.sessions, week.weekStartDate)
    return filtered.length > 0 && filtered.length === action.sessions.length
  })
  return matchedWeek?.weekStartDate
}

async function generateWeekPair(
  provider: AIProvider,
  plan: TrainingPlan,
  weeks: [TrainingPlanWeek, TrainingPlanWeek],
  previousWeek: TrainingPlanWeek | undefined,
  profile: AthleteProfile,
  wizardConfig: PlanWizardConfig,
  onChunk: ((weekIndex: number, chunk: string) => void) | undefined,
  batchId?: string,
): Promise<{
  results: BatchWeekExtraction[]
  meta: {
    provider: string
    model?: string
    traceId: string
    durationMs?: number
    chunkCount: number
    retryUsed?: boolean
    fallbackUsed?: boolean
    lastError?: string
    batchId: string
    degradeToSingle: boolean
  }
}> {
  const effectiveBatchId = batchId ?? createBatchId(weeks[0].weekIndex)
  const requestClass = 'plan_builder_pair' as const
  const traceId = buildAITraceId(requestClass)
  const policy = getAIRequestPolicy(requestClass)
  let chunkCount = 0
  const chunkRouter = createWeekBatchChunkRouter(weeks, onChunk)
  const streamingParser = createStreamingActionsParser()
  await assertDailyAIRequestLimit(requestClass)
  useAIDebugStore.getState().startRequest({
    traceId,
    requestClass,
    surface: 'plan_builder',
    startedAt: Date.now(),
  })

  try {
    const raw = await provider.call({
      requestClass,
      traceId,
      systemPrompt: buildWeekBatchStructuredSystemPromptMinimal(),
      userMessage: buildWeekBatchUserPrompt({
        plan,
        weeks,
        previousWeek,
        profile,
        wizardConfig,
        outputFormat: 'json',
      }),
      maxTokens: policy.maxTokens,
      temperature: policy.temperature,
      allowFallback: policy.allowFallback,
      responseMimeType: 'application/json',
      responseSchema: PLAN_BUILDER_PAIR_RESPONSE_SCHEMA,
      onChunk: (chunk) => {
        chunkCount += 1
        if (chunkCount === 1) {
          useAIDebugStore.getState().markFirstChunk(traceId)
        }
        chunkRouter.push(chunk)
        streamingParser.push(chunk)
      },
    })
    const normalized = normalizeResponse(raw)
    const streamedActions = streamingParser.flush().completeActions
    const finalActions = normalized.actions && normalized.actions.length > 0
      ? normalized.actions
      : streamedActions
    const weekResults = new Map<string, BatchWeekExtraction>()

    for (const week of weeks) {
      weekResults.set(week.weekStartDate, {
        week,
        sessions: [],
        error: 'El batch no devolvió una create_week válida para esta semana.',
      })
    }

    const createWeekActions = finalActions.filter((action) => action.type === 'create_week')
    for (const action of createWeekActions) {
      const targetWeekStart = getActionTargetWeekStart(action, weeks)
      if (!targetWeekStart || !Array.isArray(action.sessions)) continue
      const targetWeek = weeks.find((week) => week.weekStartDate === targetWeekStart)
      if (!targetWeek) continue
      const diagnostic = pickCreateWeekDiagnostic(normalized, targetWeekStart, action)
      const evaluation = validateGeneratedWeekAction(plan, targetWeek, profile, action, diagnostic, previousWeek)
      weekResults.set(targetWeekStart, {
        week: targetWeek,
        sessions: evaluation.error ? [] : evaluation.sessions,
        error: evaluation.error,
        rawSessionCount: evaluation.rawSessionCount,
        validSessionCount: evaluation.validSessionCount,
        droppedSessionCount: evaluation.droppedSessionCount,
        repairedSessionCount: evaluation.repairedSessionCount,
        movedSessionCount: evaluation.movedSessionCount,
        addedFallbackCount: evaluation.addedFallbackCount,
        filteredSportCount: evaluation.filteredSportCount,
        repairWarnings: evaluation.repairWarnings,
      })
    }

    const batchWarnings = [
      ...(normalized.meta?.warnings ?? []),
      ...Array.from(weekResults.values())
        .filter((result) => result.error)
        .map((result) => `validation_error:week_${result.week.weekIndex + 1}:${result.error}`),
    ]
    const degradeToSingle = Array.from(weekResults.values())
      .some((result) => result.sessions.length === 0)
    useAIDebugStore.getState().completeRequest(traceId, {
      provider: raw.provider,
      model: raw.model,
      durationMs: raw.durationMs,
      retryUsed: raw.retryUsed,
      fallbackUsed: raw.fallbackUsed,
      outcome: normalized.meta?.outcome,
      responseCharCount: raw.text.length,
      actionCount: finalActions.length,
      warnings: batchWarnings.length > 0 ? batchWarnings : undefined,
    })

    return {
      results: weeks.map((week) => weekResults.get(week.weekStartDate) ?? { week, sessions: [], error: 'Semana no encontrada en batch.' }),
      meta: {
        provider: provider.name,
        model: raw.model,
        traceId: raw.traceId ?? traceId,
        durationMs: raw.durationMs,
        chunkCount,
        retryUsed: raw.retryUsed,
        fallbackUsed: raw.fallbackUsed,
        batchId: effectiveBatchId,
        degradeToSingle,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    useAIDebugStore.getState().failRequest(traceId, {
      errorCode: message,
    })
    return {
      results: weeks.map((week) => ({
        week,
        sessions: [],
        error: `Falló el batch para la semana ${week.weekIndex + 1}: ${message}`,
      })),
      meta: {
        provider: provider.name,
        traceId,
        chunkCount,
        lastError: message,
        batchId: effectiveBatchId,
        degradeToSingle: true,
      },
    }
  }
}

/**
 * Sequentially generates sessions for each week in the plan.
 * Each week can retry independently; long plans can batch two weeks in one request.
 * Calls onWeekUpdate as weeks transition so the UI can stream and track progress.
 */
export async function generatePlanWeeks(input: GeneratePlanWeeksInput): Promise<TrainingPlanWeek[]> {
  const provider = input.provider ?? getProviderForRequestClass(
    resolveStrategy(input) === 'pairs' ? 'plan_builder_pair' : 'plan_builder_week',
  )
  const results: TrainingPlanWeek[] = []
  const strategy = resolveStrategy(input)
  let batchStrategyEnabled = strategy === 'pairs'
  let previousWeek: TrainingPlanWeek | undefined = input.seedPreviousWeek

  for (let index = 0; index < input.weeks.length; index++) {
    const week = input.weeks[index]
    if (input.abortSignal?.aborted) {
      results.push(week)
      continue
    }

    const nextWeek = input.weeks[index + 1]
    const canBatch = batchStrategyEnabled && nextWeek != null

    if (canBatch) {
      const batchWeeks: [TrainingPlanWeek, TrainingPlanWeek] = [week, nextWeek]
      const batchId = createBatchId(week.weekIndex)
      for (const batchWeek of batchWeeks) {
        input.onWeekUpdate?.(makeGeneratingWeek(batchWeek, 'pairs', batchId))
      }

      const batchResult = await generateWeekPair(
        provider,
        input.plan,
        batchWeeks,
        previousWeek,
        input.profile,
        input.wizardConfig,
        input.onChunk,
        batchId,
      )
      if (batchResult.meta.degradeToSingle) {
        batchStrategyEnabled = false
      }

      for (const batchWeekResult of batchResult.results) {
        if (batchWeekResult.sessions.length > 0) {
          const resolved = makeResolvedWeek(batchWeekResult.week, batchWeekResult.sessions, {
            attempts: 1,
            provider: batchResult.meta.provider,
            model: batchResult.meta.model,
            requestClass: 'plan_builder_pair',
            traceId: batchResult.meta.traceId,
            durationMs: batchResult.meta.durationMs,
            chunkCount: batchResult.meta.chunkCount,
            retryUsed: batchResult.meta.retryUsed,
            fallbackUsed: batchResult.meta.fallbackUsed,
            strategy: 'pairs',
            batchId: batchResult.meta.batchId,
            rawSessionCount: batchWeekResult.rawSessionCount,
            validSessionCount: batchWeekResult.validSessionCount,
            droppedSessionCount: batchWeekResult.droppedSessionCount,
            repairedSessionCount: batchWeekResult.repairedSessionCount,
            movedSessionCount: batchWeekResult.movedSessionCount,
            addedFallbackCount: batchWeekResult.addedFallbackCount,
            filteredSportCount: batchWeekResult.filteredSportCount,
            repairWarnings: batchWeekResult.repairWarnings,
          })
          input.onWeekUpdate?.(resolved)
          results.push(resolved)
          if (resolved.status === 'draft') {
            previousWeek = resolved
          }
          continue
        }

        let recovered: TrainingPlanWeek | undefined
        if (batchResult.meta.degradeToSingle) {
          recovered = await generateSingleWeekWithRetry(
            provider,
            input.plan,
            batchWeekResult.week,
            previousWeek,
            input.profile,
            input.wizardConfig,
            input.onChunk,
          )
          if (recovered.sessions.length > 0 && !recovered.generationMeta.fallbackUsed) {
            input.onWeekUpdate?.(recovered)
            results.push(recovered)
            previousWeek = recovered
            continue
          }
        }

        const localFallback = recovered ?? makeLocalFallbackResolvedWeek({
          plan: input.plan,
          week: batchWeekResult.week,
          previousWeek,
          profile: input.profile,
          wizardConfig: input.wizardConfig,
          attempts: 1,
          provider: batchResult.meta.provider,
          model: batchResult.meta.model,
          requestClass: 'plan_builder_pair',
          traceId: batchResult.meta.traceId,
          lastError: batchWeekResult.error,
          durationMs: batchResult.meta.durationMs,
          chunkCount: batchResult.meta.chunkCount,
          strategy: 'pairs',
          batchId: batchResult.meta.batchId,
          rawSessionCount: batchWeekResult.rawSessionCount,
          droppedSessionCount: batchWeekResult.droppedSessionCount,
          degradedFromPairs: true,
        })
        input.onWeekUpdate?.(localFallback)
        results.push(localFallback)
        if (localFallback.status === 'draft') {
          previousWeek = localFallback
        }
      }

      index += 1
      continue
    }

    input.onWeekUpdate?.(makeGeneratingWeek(week, 'single'))
    const resolved = await generateSingleWeekWithRetry(
      provider,
      input.plan,
      week,
      previousWeek,
      input.profile,
      input.wizardConfig,
      input.onChunk,
    )
    input.onWeekUpdate?.(resolved)
    results.push(resolved)
    if (resolved.status === 'draft') {
      previousWeek = resolved
    }
  }

  return results
}
