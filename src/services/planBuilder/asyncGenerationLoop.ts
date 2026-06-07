import type { AthleteProfile, PlanWizardConfig } from '../../types'
import type { AIRawResponse, AIRequest } from '../ai/types'
import type { PlanGenerationSummary, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { generateWeekCore } from './generateWeekCore'
import { countReadyWeeks, isReadyWeek, sortWeeks } from './weekUtils'

export interface AsyncPlanGenerationWriter {
  getPlan(planId: string): Promise<TrainingPlan | null>
  putPlan(plan: TrainingPlan): Promise<void>
  putWeek(week: TrainingPlanWeek): Promise<void>
}

export interface RunAsyncPlanGenerationInput {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  recentContext?: unknown
  targetWeekIndexes?: number[]
  repairInstructions?: Record<number, string>
  jobId: string
  writer: AsyncPlanGenerationWriter
  callLLM: (request: AIRequest) => Promise<AIRawResponse>
  now?: () => number
  maxTokens?: number
  temperature?: number
}

export interface AsyncPlanGenerationResult {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  cancelled: boolean
}

const DEFAULT_MAX_TOKENS = 3500
const DEFAULT_TEMPERATURE = 0.25

function failedWeeks(weeks: TrainingPlanWeek[]): number[] {
  return weeks
    .filter((week) => week.status === 'error')
    .map((week) => week.weekIndex)
    .sort((a, b) => a - b)
}

function totalAttempts(weeks: TrainingPlanWeek[]): number {
  return weeks.reduce((sum, week) => sum + (week.generationMeta.attempts ?? 0), 0)
}

function deriveAsyncGenerationState(weeks: TrainingPlanWeek[]): TrainingPlan['generationState'] {
  if (weeks.some((week) => week.status === 'generating')) return 'generating'
  if (weeks.length === 0) return 'shell'
  const readyWeeks = countReadyWeeks(weeks)
  if (readyWeeks === weeks.length) return 'complete'
  if (readyWeeks > 0) return 'partial'
  if (weeks.some((week) => week.status === 'error' || (week.generationMeta.attempts ?? 0) > 0)) return 'failed'
  return 'shell'
}

function replaceWeek(weeks: TrainingPlanWeek[], next: TrainingPlanWeek): TrainingPlanWeek[] {
  return sortWeeks(weeks.map((week) => (week.weekIndex === next.weekIndex ? next : week)))
}

function buildSummary(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  input: {
    jobId: string
    startedAt: number
    heartbeatAt: number
    completedAt?: number
    cancelRequested?: boolean
  },
): PlanGenerationSummary {
  return {
    startedAt: plan.generationSummary?.startedAt ?? input.startedAt,
    jobId: input.jobId,
    completedAt: input.completedAt,
    totalDurationMs: input.completedAt ? input.completedAt - (plan.generationSummary?.startedAt ?? input.startedAt) : undefined,
    strategy: 'single',
    completedWeeks: countReadyWeeks(weeks),
    failedWeeks: failedWeeks(weeks),
    totalAttempts: totalAttempts(weeks),
    heartbeatAt: input.heartbeatAt,
    cancelRequested: input.cancelRequested ?? plan.generationSummary?.cancelRequested,
    acceptedAt: plan.generationSummary?.acceptedAt,
    discardedAt: plan.generationSummary?.discardedAt,
    qualityReview: plan.generationSummary?.qualityReview,
  }
}

function buildPlanCheckpoint(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  input: {
    generationState: TrainingPlan['generationState']
    jobId: string
    startedAt: number
    updatedAt: number
    completedAt?: number
    cancelRequested?: boolean
  },
): TrainingPlan {
  return {
    ...plan,
    generationState: input.generationState,
    updatedAt: input.updatedAt,
    generationSummary: buildSummary(plan, weeks, {
      jobId: input.jobId,
      startedAt: input.startedAt,
      heartbeatAt: input.updatedAt,
      completedAt: input.completedAt,
      cancelRequested: input.cancelRequested,
    }),
  }
}

function makeGeneratingWeek(week: TrainingPlanWeek, timestamp: number): TrainingPlanWeek {
  return {
    ...week,
    status: 'generating',
    validationIssues: [],
    generationMeta: {
      ...week.generationMeta,
      attempts: week.generationMeta.attempts ?? 0,
      strategy: 'single',
    },
    updatedAt: timestamp,
  }
}

function makeResolvedWeek(
  week: TrainingPlanWeek,
  result: Awaited<ReturnType<typeof generateWeekCore>>,
  timestamp: number,
): TrainingPlanWeek {
  return {
    ...week,
    status: result.sessions.length > 0 ? 'draft' : 'error',
    sessions: result.sessions,
    generationMeta: {
      ...week.generationMeta,
      attempts: (week.generationMeta.attempts ?? 0) + result.meta.attempts,
      provider: result.meta.provider,
      model: result.meta.model,
      requestClass: result.meta.requestClass,
      traceId: result.meta.traceId,
      lastError: result.meta.lastError,
      lastAttemptAt: timestamp,
      durationMs: result.meta.durationMs,
      retryUsed: result.meta.retryUsed,
      fallbackUsed: result.meta.fallbackUsed,
      strategy: 'single',
      rawSessionCount: result.meta.rawSessionCount,
      validSessionCount: result.meta.validSessionCount,
      droppedSessionCount: result.meta.droppedSessionCount,
      repairedSessionCount: result.meta.repairedSessionCount,
      movedSessionCount: result.meta.movedSessionCount,
      addedFallbackCount: result.meta.addedFallbackCount,
      filteredSportCount: result.meta.filteredSportCount,
      repairWarnings: result.meta.repairWarnings,
      errorClass: result.meta.errorClass,
      generationSource: 'ai',
    },
    updatedAt: timestamp,
  }
}

function makeErroredWeek(week: TrainingPlanWeek, message: string, timestamp: number): TrainingPlanWeek {
  return {
    ...week,
    status: 'error',
    sessions: [],
    generationMeta: {
      ...week.generationMeta,
      attempts: Math.max(1, (week.generationMeta.attempts ?? 0) + 1),
      lastError: message,
      lastAttemptAt: timestamp,
      strategy: 'single',
      generationSource: 'ai',
    },
    updatedAt: timestamp,
  }
}

export async function runAsyncPlanGeneration(input: RunAsyncPlanGenerationInput): Promise<AsyncPlanGenerationResult> {
  const getNow = input.now ?? Date.now
  const startedAt = input.plan.generationSummary?.startedAt ?? getNow()
  let plan = buildPlanCheckpoint(input.plan, input.weeks, {
    generationState: 'generating',
    jobId: input.jobId,
    startedAt,
    updatedAt: startedAt,
  })
  let weeks = sortWeeks(input.weeks)
  await input.writer.putPlan(plan)

  const targetWeekIndexes = input.targetWeekIndexes?.length
    ? [...input.targetWeekIndexes].sort((a, b) => a - b)
    : weeks.map((week) => week.weekIndex)

  for (const weekIndex of targetWeekIndexes) {
    const freshPlan = await input.writer.getPlan(plan.id)
    if (freshPlan?.generationSummary?.cancelRequested) {
      const timestamp = getNow()
      plan = buildPlanCheckpoint(freshPlan, weeks, {
        generationState: 'cancelled',
        jobId: input.jobId,
        startedAt,
        updatedAt: timestamp,
        completedAt: timestamp,
        cancelRequested: true,
      })
      await input.writer.putPlan(plan)
      return { plan, weeks, cancelled: true }
    }

    const target = weeks.find((week) => week.weekIndex === weekIndex)
    if (!target) continue
    if (!input.targetWeekIndexes?.length && isReadyWeek(target)) continue

    const generatingWeek = makeGeneratingWeek(target, getNow())
    weeks = replaceWeek(weeks, generatingWeek)
    await input.writer.putWeek(generatingWeek)
    plan = buildPlanCheckpoint(freshPlan ?? plan, weeks, {
      generationState: 'generating',
      jobId: input.jobId,
      startedAt,
      updatedAt: generatingWeek.updatedAt,
    })
    await input.writer.putPlan(plan)

    try {
      const previousWeek = weeks.find((week) => week.weekIndex === weekIndex - 1 && isReadyWeek(week))
      const result = await generateWeekCore({
        plan,
        week: generatingWeek,
        previousWeek,
        profile: input.profile,
        wizardConfig: input.wizardConfig,
        recentContext: input.recentContext as never,
        retryInstruction: input.repairInstructions?.[weekIndex],
        traceId: `${input.jobId}-week-${weekIndex}`,
        maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: input.temperature ?? DEFAULT_TEMPERATURE,
        callLLM: input.callLLM,
      })
      const resolvedWeek = makeResolvedWeek(generatingWeek, result, getNow())
      weeks = replaceWeek(weeks, resolvedWeek)
      await input.writer.putWeek(resolvedWeek)
      plan = buildPlanCheckpoint(plan, weeks, {
        generationState: 'generating',
        jobId: input.jobId,
        startedAt,
        updatedAt: resolvedWeek.updatedAt,
      })
      await input.writer.putPlan(plan)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const erroredWeek = makeErroredWeek(generatingWeek, message, getNow())
      weeks = replaceWeek(weeks, erroredWeek)
      await input.writer.putWeek(erroredWeek)
      plan = buildPlanCheckpoint(plan, weeks, {
        generationState: 'generating',
        jobId: input.jobId,
        startedAt,
        updatedAt: erroredWeek.updatedAt,
      })
      await input.writer.putPlan(plan)
    }
  }

  const completedAt = getNow()
  plan = buildPlanCheckpoint(plan, weeks, {
    generationState: deriveAsyncGenerationState(weeks),
    jobId: input.jobId,
    startedAt,
    updatedAt: completedAt,
    completedAt,
  })
  await input.writer.putPlan(plan)
  return { plan, weeks, cancelled: false }
}
