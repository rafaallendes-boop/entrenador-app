import { db } from '../../db/db'
import type { AthleteProfile } from '../../types'
import type { PlanGenerationJob, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { generatePlanWeeks } from './generatePlan'
import { buildPlanBuilderRecentContext } from './recentContext'
import { reviewPlanQuality } from './qualityReview'
import {
  derivePlanGenerationState,
  resolveConfiguredGenerationMode,
  resolveConfiguredGenerationStrategy,
  shouldUseDeterministicPrimary,
} from './generationState'
import { countReadyWeeks, isReadyWeek, sortWeeks } from './weekUtils'

const ACTIVE_JOB_STATUSES = new Set<PlanGenerationJob['status']>(['queued', 'running'])
const runningJobs = new Map<string, Promise<void>>()

interface RunnerCallbacks {
  onJobUpdate?: (job: PlanGenerationJob) => void
  onPlanUpdate?: (plan: TrainingPlan, weeks: TrainingPlanWeek[]) => void
  onWeekUpdate?: (week: TrainingPlanWeek) => void
  onError?: (message: string) => void
}

interface CreateGenerationJobInput {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  targetWeekIndexes?: number[]
  strategy?: 'single' | 'pairs'
  repairInstructions?: Record<number, string>
}

interface RunGenerationJobInput {
  jobId: string
  profile: AthleteProfile
  callbacks?: RunnerCallbacks
}

function now() {
  return Date.now()
}

function createJobId(planId: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `plan-job-${crypto.randomUUID()}`
  }
  return `plan-job-${planId}-${now()}-${Math.random().toString(36).slice(2)}`
}


function failedIndexes(weeks: TrainingPlanWeek[]): number[] {
  return weeks
    .filter((week) => week.status === 'error')
    .map((week) => week.weekIndex)
    .sort((a, b) => a - b)
}

function totalAttempts(weeks: TrainingPlanWeek[]): number {
  return weeks.reduce((sum, week) => sum + (week.generationMeta.attempts ?? 0), 0)
}

function replaceWeek(weeks: TrainingPlanWeek[], next: TrainingPlanWeek): TrainingPlanWeek[] {
  return sortWeeks(weeks.map((week) => (week.weekIndex === next.weekIndex ? next : week)))
}

function buildPlanCheckpoint(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  job: PlanGenerationJob,
  completedAt?: number,
  profile?: AthleteProfile,
): TrainingPlan {
  const terminalState = derivePlanGenerationState(weeks)
  const qualityReview = completedAt
    ? reviewPlanQuality(plan, weeks, { profile })
    : plan.generationSummary?.qualityReview
  return {
    ...plan,
    generationState: completedAt ? terminalState : 'generating',
    updatedAt: completedAt ?? now(),
    generationSummary: {
      startedAt: job.startedAt ?? job.createdAt,
      completedAt,
      totalDurationMs: completedAt && (job.startedAt ?? job.createdAt)
        ? completedAt - (job.startedAt ?? job.createdAt)
        : undefined,
      strategy: job.strategy,
      completedWeeks: countReadyWeeks(weeks),
      failedWeeks: failedIndexes(weeks),
      totalAttempts: totalAttempts(weeks),
      acceptedAt: plan.generationSummary?.acceptedAt,
      discardedAt: plan.generationSummary?.discardedAt,
      qualityReview,
    },
  }
}

function buildJobUpdate(
  job: PlanGenerationJob,
  weeks: TrainingPlanWeek[],
  input: Partial<PlanGenerationJob>,
): PlanGenerationJob {
  const timestamp = now()
  return {
    ...job,
    completedWeeks: countReadyWeeks(weeks),
    failedWeekIndexes: failedIndexes(weeks),
    heartbeatAt: timestamp,
    updatedAt: timestamp,
    ...input,
  }
}

async function putJob(job: PlanGenerationJob, callbacks?: RunnerCallbacks): Promise<void> {
  await db.planGenerationJobs.put(job)
  callbacks?.onJobUpdate?.(job)
}

async function putPlanAndWeeks(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  callbacks?: RunnerCallbacks,
): Promise<void> {
  await db.trainingPlans.put(plan)
  await db.trainingPlanWeeks.bulkPut(weeks)
  callbacks?.onPlanUpdate?.(plan, sortWeeks(weeks))
}

async function loadPlanWeeks(planId: string): Promise<TrainingPlanWeek[]> {
  return sortWeeks(await db.trainingPlanWeeks.where('planId').equals(planId).toArray())
}

async function cancelActiveJobsForPlan(planId: string): Promise<void> {
  const activeJobs = await db.planGenerationJobs.where('planId').equals(planId).toArray()
  const timestamp = now()
  await Promise.all(activeJobs
    .filter((job) => ACTIVE_JOB_STATUSES.has(job.status))
    .map((job) => db.planGenerationJobs.put({
      ...job,
      status: 'cancelled' as const,
      completedAt: timestamp,
      heartbeatAt: timestamp,
      updatedAt: timestamp,
      lastError: 'Cancelado por un nuevo job de generación.',
    })))
}

export async function createPlanGenerationJob(input: CreateGenerationJobInput): Promise<PlanGenerationJob> {
  await cancelActiveJobsForPlan(input.plan.id)
  const timestamp = now()
  const job: PlanGenerationJob = {
    id: createJobId(input.plan.id),
    planId: input.plan.id,
    athleteId: input.plan.athleteId,
    status: 'queued',
    strategy: resolveConfiguredGenerationStrategy(input.plan.totalWeeks, input.strategy ?? 'single'),
    targetWeekIndexes: input.targetWeekIndexes?.length ? [...input.targetWeekIndexes].sort((a, b) => a - b) : undefined,
    totalWeeks: input.weeks.length,
    completedWeeks: countReadyWeeks(input.weeks),
    failedWeekIndexes: failedIndexes(input.weeks),
    currentWeekIndex: null,
    repairInstructions: input.repairInstructions,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await db.planGenerationJobs.put(job)
  return job
}

export async function getLatestPlanGenerationJob(planId: string): Promise<PlanGenerationJob | null> {
  const jobs = await db.planGenerationJobs.where('planId').equals(planId).toArray()
  return jobs.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}

export async function getRunnablePlanGenerationJobs(athleteId: string): Promise<PlanGenerationJob[]> {
  const jobs = await db.planGenerationJobs.where('athleteId').equals(athleteId).toArray()
  return jobs
    .filter((job) => ACTIVE_JOB_STATUSES.has(job.status))
    .sort((a, b) => a.createdAt - b.createdAt)
}

export function isPlanGenerationJobRunning(jobId: string): boolean {
  return runningJobs.has(jobId)
}

export async function runPlanGenerationJob(input: RunGenerationJobInput): Promise<void> {
  const activeRun = runningJobs.get(input.jobId)
  if (activeRun) return activeRun

  const run = runPlanGenerationJobInternal(input)
  runningJobs.set(input.jobId, run)
  try {
    await run
  } finally {
    runningJobs.delete(input.jobId)
  }
}

async function runPlanGenerationJobInternal({ jobId, profile, callbacks }: RunGenerationJobInput): Promise<void> {
  const initialJob = await db.planGenerationJobs.get(jobId)
  if (!initialJob || !ACTIVE_JOB_STATUSES.has(initialJob.status)) return
  let job: PlanGenerationJob = initialJob

  const plan = await db.trainingPlans.get(job.planId)
  if (!plan) {
    const failedJob = buildJobUpdate(job, [], {
      status: 'failed',
      completedAt: now(),
      lastError: 'No se encontró el plan asociado al job.',
    })
    await putJob(failedJob, callbacks)
    callbacks?.onError?.(failedJob.lastError ?? 'Job fallido')
    return
  }

  let weeks = await loadPlanWeeks(plan.id)
  const startedAt = job.startedAt ?? now()
  const generationMode = resolveConfiguredGenerationMode()
  const recentContext = await buildPlanBuilderRecentContext(plan).catch(() => undefined)
  job = buildJobUpdate(job, weeks, {
    status: 'running',
    startedAt,
    completedAt: undefined,
    lastError: undefined,
  })
  await putJob(job, callbacks)
  await putPlanAndWeeks(buildPlanCheckpoint(plan, weeks, job), weeks, callbacks)

  const targetWeekIndexes = job.targetWeekIndexes ?? weeks.map((week) => week.weekIndex)
  let latestPlan = plan

  for (const weekIndex of targetWeekIndexes) {
    const freshJob = await db.planGenerationJobs.get(job.id)
    if (!freshJob || !ACTIVE_JOB_STATUSES.has(freshJob.status)) return
    job = freshJob

    latestPlan = await db.trainingPlans.get(plan.id) ?? latestPlan
    weeks = await loadPlanWeeks(plan.id)
    const target = weeks.find((week) => week.weekIndex === weekIndex)
    if (!target) continue
    if (!job.targetWeekIndexes && isReadyWeek(target)) continue

    job = buildJobUpdate(job, weeks, { currentWeekIndex: weekIndex, status: 'running' })
    await putJob(job, callbacks)

    const generatingWeek: TrainingPlanWeek = {
      ...target,
      status: 'generating',
      sessions: job.targetWeekIndexes ? [] : target.sessions,
      validationIssues: [],
      generationMeta: { attempts: 0, strategy: 'single' },
      updatedAt: now(),
    }
    weeks = replaceWeek(weeks, generatingWeek)
    await db.trainingPlanWeeks.put(generatingWeek)
    callbacks?.onWeekUpdate?.(generatingWeek)
    await putPlanAndWeeks(buildPlanCheckpoint(latestPlan, weeks, job), weeks, callbacks)

    try {
      const previousWeek = weeks.find((week) => week.weekIndex === weekIndex - 1 && isReadyWeek(week))
      const generatedWeeks = await generatePlanWeeks({
        plan: latestPlan,
        weeks: [{ ...generatingWeek, status: 'pending' }],
        profile,
        wizardConfig: latestPlan.wizardConfig,
        seedPreviousWeek: previousWeek,
        strategy: 'single',
        deterministicPrimary: shouldUseDeterministicPrimary(generationMode),
        recentContext,
        repairInstructionsByWeekIndex: job.repairInstructions,
        onWeekUpdate: (next) => {
          weeks = replaceWeek(weeks, next)
          callbacks?.onWeekUpdate?.(next)
          void db.trainingPlanWeeks.put(next)
        },
      })

      const generated = generatedWeeks[0] ?? {
        ...generatingWeek,
        status: 'error' as const,
        sessions: [],
        generationMeta: {
          ...generatingWeek.generationMeta,
          attempts: Math.max(1, generatingWeek.generationMeta.attempts ?? 0),
          lastError: 'La generación no devolvió una semana.',
        },
        updatedAt: now(),
      }

      const latestJob = await db.planGenerationJobs.get(job.id)
      if (!latestJob || !ACTIVE_JOB_STATUSES.has(latestJob.status)) return
      job = latestJob

      weeks = replaceWeek(await loadPlanWeeks(plan.id), generated)
      await db.trainingPlanWeeks.put(generated)
      callbacks?.onWeekUpdate?.(generated)

      const checkpointPlan = buildPlanCheckpoint(latestPlan, weeks, job)
      latestPlan = checkpointPlan
      job = buildJobUpdate(job, weeks, { currentWeekIndex: null })
      await putPlanAndWeeks(checkpointPlan, weeks, callbacks)
      await putJob(job, callbacks)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const errored: TrainingPlanWeek = {
        ...generatingWeek,
        status: 'error',
        sessions: [],
        generationMeta: {
          ...generatingWeek.generationMeta,
          attempts: Math.max(1, generatingWeek.generationMeta.attempts ?? 0),
          lastError: message,
          lastAttemptAt: now(),
        },
        updatedAt: now(),
      }
      weeks = replaceWeek(weeks, errored)
      await db.trainingPlanWeeks.put(errored)
      callbacks?.onWeekUpdate?.(errored)
      job = buildJobUpdate(job, weeks, {
        currentWeekIndex: null,
        lastError: message,
      })
      await putPlanAndWeeks(buildPlanCheckpoint(latestPlan, weeks, job), weeks, callbacks)
      await putJob(job, callbacks)
    }
  }

  weeks = await loadPlanWeeks(plan.id)
  const completedAt = now()
  const finalPlan = buildPlanCheckpoint(await db.trainingPlans.get(plan.id) ?? latestPlan, weeks, job, completedAt, profile)
  const targetFailures = (job.targetWeekIndexes ?? weeks.map((week) => week.weekIndex))
    .filter((weekIndex) => {
      const week = weeks.find((candidate) => candidate.weekIndex === weekIndex)
      return !week || !isReadyWeek(week)
    })
  const finalJob = buildJobUpdate(job, weeks, {
    status: targetFailures.length > 0 ? 'failed' : 'succeeded',
    currentWeekIndex: null,
    completedAt,
    lastError: targetFailures.length > 0
      ? `No se pudieron completar ${targetFailures.length} semana(s).`
      : undefined,
  })

  await putPlanAndWeeks(finalPlan, weeks, callbacks)
  await putJob(finalJob, callbacks)
  if (finalJob.status === 'failed' && finalJob.lastError) {
    callbacks?.onError?.(finalJob.lastError)
  }
}
