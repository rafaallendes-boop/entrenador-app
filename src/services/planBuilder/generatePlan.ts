import type { AIProvider } from '../ai/types'
import { ClaudeProvider } from '../ai/providers/ClaudeProvider'
import { OpenAIProvider } from '../ai/providers/OpenAIProvider'
import { GeminiProvider } from '../ai/providers/GeminiProvider'
import { MockProvider } from '../ai/providers/MockProvider'
import { ProxyProvider } from '../ai/providers/ProxyProvider'
import type { AthleteProfile, CoachAction, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { buildAITraceId, getAIRequestPolicy } from '../ai/requestPolicy'
import { normalizeResponse } from '../ai/responseNormalizer'
import {
  filterSessionsToWeek,
  generateWeek,
  pickCreateWeekDiagnostic,
  summarizeWeekGenerationError,
  validateGeneratedWeekAction,
} from './generateWeek'
import { buildWeekBatchSystemPrompt, buildWeekBatchUserPrompt } from './prompts/weekPrompt'

function getActiveProvider(): AIProvider {
  if (import.meta.env.PROD) return new ProxyProvider()
  const name = (import.meta.env.VITE_AI_PROVIDER ?? 'mock').toLowerCase()
  switch (name) {
    case 'proxy': return new ProxyProvider()
    case 'claude': return new ClaudeProvider()
    case 'openai': return new OpenAIProvider()
    case 'gemini': return new GeminiProvider()
    default: return new MockProvider()
  }
}

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
  if (input.strategy) return input.strategy
  if (import.meta.env.PROD) return 'single'
  if (input.weeks.length >= 8 || input.plan.totalWeeks >= 8) return 'pairs'
  return 'single'
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
    },
    updatedAt: nowTs,
  }
}

function normalizeRetryInstruction(error: string | undefined, week: TrainingPlanWeek, attempt: number): string | undefined {
  if (attempt <= 1) return undefined
  const base = summarizeWeekGenerationError(error, week)
  if (attempt === 2) {
    return `${base} Recuerda respetar exactamente el rango de 7 días que empieza el ${week.weekStartDate} y mantener una única create_week para esa semana.`
  }
  return `${base} Usa formato estricto: targetDate=${week.weekStartDate}, sesiones compactas y todas las fechas dentro de esa semana.`
}

async function generateSingleWeekWithRetry(
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
  let validSessionCount: number | undefined
  let droppedSessionCount: number | undefined

  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await generateWeek({
      provider,
      plan,
      week,
      previousWeek,
      profile,
      wizardConfig,
      temperature: attempt === 1 ? 0.4 : 0.25,
      retryInstruction: normalizeRetryInstruction(lastError, week, attempt),
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
    validSessionCount = result.meta.validSessionCount
    droppedSessionCount = result.meta.droppedSessionCount

    if (result.sessions.length > 0) {
      return makeResolvedWeek(week, result.sessions, {
        attempts,
        provider: providerName,
        model,
        durationMs,
        chunkCount,
        strategy: 'single',
        rawSessionCount,
        validSessionCount,
        droppedSessionCount,
      })
    }
  }

  return makeResolvedWeek(week, [], {
    attempts,
    provider: providerName,
    model,
    lastError,
    durationMs,
    chunkCount,
    strategy: 'single',
    rawSessionCount,
    validSessionCount,
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
  const batchId = createBatchId(weeks[0].weekIndex)
  const requestClass = 'plan_builder_pair' as const
  const traceId = buildAITraceId(requestClass)
  const policy = getAIRequestPolicy(requestClass)
  let chunkCount = 0
  const chunkRouter = createWeekBatchChunkRouter(weeks, onChunk)

  try {
    const raw = await provider.call({
      requestClass,
      traceId,
      systemPrompt: buildWeekBatchSystemPrompt(),
      userMessage: buildWeekBatchUserPrompt({
        plan,
        weeks,
        previousWeek,
        profile,
        wizardConfig,
      }),
      maxTokens: policy.maxTokens,
      temperature: policy.temperature,
      allowFallback: policy.allowFallback,
      onChunk: (chunk) => {
        chunkCount += 1
        chunkRouter.push(chunk)
      },
    })
    const normalized = normalizeResponse(raw)
    const weekResults = new Map<string, BatchWeekExtraction>()

    for (const week of weeks) {
      weekResults.set(week.weekStartDate, {
        week,
        sessions: [],
        error: 'El batch no devolvió una create_week válida para esta semana.',
      })
    }

    const createWeekActions = (normalized.actions ?? []).filter((action) => action.type === 'create_week')
    for (const action of createWeekActions) {
      const targetWeekStart = getActionTargetWeekStart(action, weeks)
      if (!targetWeekStart || !Array.isArray(action.sessions)) continue
      const targetWeek = weeks.find((week) => week.weekStartDate === targetWeekStart)
      if (!targetWeek) continue
      const diagnostic = pickCreateWeekDiagnostic(normalized, targetWeekStart, action)
      const evaluation = validateGeneratedWeekAction(plan, targetWeek, action, diagnostic)
      weekResults.set(targetWeekStart, {
        week: targetWeek,
        sessions: evaluation.error ? [] : evaluation.sessions,
        error: evaluation.error,
        rawSessionCount: evaluation.rawSessionCount,
        validSessionCount: evaluation.validSessionCount,
        droppedSessionCount: evaluation.droppedSessionCount,
      })
    }

    const degradeToSingle =
      normalized.meta?.actionParseFailed === true
      || normalized.meta?.likelyTruncated === true
      || weekResults.size !== weeks.length
      || Array.from(weekResults.values()).some((result) => result.error != null)

    return {
      results: weeks.map((week) => weekResults.get(week.weekStartDate) ?? { week, sessions: [], error: 'Semana no encontrada en batch.' }),
      meta: {
        provider: provider.name,
        model: raw.model,
        traceId: raw.traceId,
        durationMs: raw.durationMs,
        chunkCount,
        retryUsed: raw.retryUsed,
        fallbackUsed: raw.fallbackUsed,
        batchId,
        degradeToSingle,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
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
        batchId,
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
  const provider = input.provider ?? getActiveProvider()
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
          })
          input.onWeekUpdate?.(resolved)
          results.push(resolved)
          if (resolved.status === 'draft') {
            previousWeek = resolved
          }
          continue
        }

        const fallbackResolved = await generateSingleWeekWithRetry(
          provider,
          input.plan,
          batchWeekResult.week,
          previousWeek,
          input.profile,
          input.wizardConfig,
          input.onChunk,
        )
        const adjustedFallback: TrainingPlanWeek = {
          ...fallbackResolved,
          generationMeta: {
            ...fallbackResolved.generationMeta,
            attempts: (fallbackResolved.generationMeta.attempts ?? 0) + 1,
            durationMs: (fallbackResolved.generationMeta.durationMs ?? 0) + (batchResult.meta.durationMs ?? 0),
            chunkCount: (fallbackResolved.generationMeta.chunkCount ?? 0) + batchResult.meta.chunkCount,
            degradedFromPairs: true,
          },
        }
        input.onWeekUpdate?.(adjustedFallback)
        results.push(adjustedFallback)
        if (adjustedFallback.status === 'draft') {
          previousWeek = adjustedFallback
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
