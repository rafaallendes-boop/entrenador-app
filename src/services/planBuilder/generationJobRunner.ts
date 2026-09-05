import { db } from '../../db/db'
import { toISO } from '../../utils/date'
import type { AthleteProfile } from '../../types'
import type { PlanGenerationJob, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { generatePlanWeeks } from './generatePlan'
import { buildPlanBuilderRecentContext } from './recentContext'
import {
  PRODUCTIVE_QUALITY_VERSION,
  resolveEffectiveRunQualityVersion,
  reviewPlanQuality,
} from './qualityReview'
import {
  derivePlanGenerationState,
  resolveConfiguredGenerationMode,
  resolveConfiguredGenerationStrategy,
  shouldUseDeterministicPrimary,
} from './generationState'
import { countReadyWeeks, isReadyWeek, sortWeeks } from './weekUtils'
import { hasAthleteDeleteTombstoneForAthlete } from '../sync/athleteDeleteTombstones'
import { runAthleteWrite } from '../sync/athleteWriteLease'

const ACTIVE_JOB_STATUSES = new Set<PlanGenerationJob['status']>(['queued', 'running'])
const runningJobs = new Map<string, Promise<void>>()

/** No runner checkpoint may recreate local data once athlete deletion starts. */
function canWriteForAthlete(athleteId: string): boolean {
  return !hasAthleteDeleteTombstoneForAthlete(athleteId)
}

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

/**
 * Marca la semana con la versión de calidad de la corrida. El worker remoto lo
 * hace en `makeResolvedWeek`; acá se aplica al salir del motor local para que
 * ambas rutas dejen la misma evidencia y un plan no cambie de metodología por
 * haberse regenerado sin conexión.
 *
 * Solo marca v2 cuando la semana realmente trae taxonomía v2. El motor local
 * tiene caminos que no la producen, y marcar v2 sobre una semana sin taxonomía
 * rompería el invariante `qualityVersion 2 ⟹ repairTaxonomyVersion 2` del que
 * depende `resolveQualityVersion`.
 */
function withQualityVersion(week: TrainingPlanWeek, qualityVersion: 1 | 2): TrainingPlanWeek {
  if (qualityVersion === 2 && week.generationMeta.repairTaxonomyVersion !== 2) return week
  return {
    ...week,
    generationMeta: { ...week.generationMeta, qualityVersion },
  }
}

function buildPlanCheckpoint(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  job: PlanGenerationJob,
  completedAt?: number,
  profile?: AthleteProfile,
): TrainingPlan {
  const terminalState = derivePlanGenerationState(weeks)
  // A diferencia del worker remoto, acá el único review ocurre con todas las
  // semanas ya asentadas, así que la inferencia es exacta: el estampado
  // condicional garantiza que solo hay marca v2 donde hay taxonomía v2. Pedir
  // la versión explícita haría lanzar a la corrida cuando el motor local
  // devuelve una semana sin taxonomía, matando una generación que iba bien.
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

async function putJob(job: PlanGenerationJob, callbacks?: RunnerCallbacks): Promise<boolean> {
  let wrote = false
  const leaseAcquired = await runAthleteWrite(job.athleteId, async () => {
    wrote = await db.transaction('rw', db.trainingPlans, db.planGenerationJobs, async () => {
      const parent = await db.trainingPlans.get(job.planId)
      if (!parent || parent.status === 'archived' || parent.status === 'superseded') return false
      await db.planGenerationJobs.put(job)
      return true
    })
    if (!wrote) return
    callbacks?.onJobUpdate?.(job)
  })
  return leaseAcquired && wrote
}

async function putPlanAndWeeks(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  callbacks?: RunnerCallbacks,
): Promise<boolean> {
  let wrote = false
  const leaseAcquired = await runAthleteWrite(plan.athleteId, async () => {
    wrote = await db.transaction('rw', db.trainingPlans, db.trainingPlanWeeks, async () => {
      // The plan may have been deleted while generation was awaiting the
      // provider. Checking inside the same transaction prevents this checkpoint
      // from recreating the parent and all of its weeks.
      const persistedPlan = await db.trainingPlans.get(plan.id)
      if (!persistedPlan) return false
      // Closing a cycle is also terminal for an in-flight checkpoint. A runner
      // that captured `active`/`draft` before the close must never restore that
      // stale status over archived/superseded.
      if (
        (persistedPlan.status === 'archived' || persistedPlan.status === 'superseded')
        && plan.status !== persistedPlan.status
      ) {
        return false
      }
      await db.trainingPlans.put(plan)
      await db.trainingPlanWeeks.bulkPut(weeks)
      return true
    })
    if (!wrote) return
    // Los subscribers son UI, no parte del commit: un throw no debe revertir
    // un checkpoint que Dexie ya confirmó.
    callbacks?.onPlanUpdate?.(plan, sortWeeks(weeks))
  })
  return leaseAcquired && wrote
}

async function putWeek(
  week: TrainingPlanWeek,
  callbacks?: RunnerCallbacks,
  leaseAthleteId = week.athleteId,
): Promise<boolean> {
  let wrote = false
  const leaseAcquired = await runAthleteWrite(leaseAthleteId, async () => {
    wrote = await db.transaction('rw', db.trainingPlans, db.trainingPlanWeeks, async () => {
      const parent = await db.trainingPlans.get(week.planId)
      if (!parent || parent.status === 'archived' || parent.status === 'superseded') return false
      await db.trainingPlanWeeks.put(week)
      return true
    })
    if (!wrote) return
    callbacks?.onWeekUpdate?.(week)
  })
  return leaseAcquired && wrote
}

/** Mantiene el contrato de streaming: reveal inmediato y persistencia detrás. */
function putStreamingWeek(
  athleteId: string,
  week: TrainingPlanWeek,
  callbacks?: RunnerCallbacks,
): Promise<boolean> {
  if (!canWriteForAthlete(athleteId)) return Promise.resolve(false)
  callbacks?.onWeekUpdate?.(week)
  return putWeek(week, undefined, athleteId)
}

async function loadPlanWeeks(planId: string): Promise<TrainingPlanWeek[]> {
  return sortWeeks(await db.trainingPlanWeeks.where('planId').equals(planId).toArray())
}

async function cancelActiveJobsForPlan(planId: string): Promise<void> {
  const activeJobs = await db.planGenerationJobs.where('planId').equals(planId).toArray()
  const timestamp = now()
  await Promise.all(activeJobs
    .filter((job) => ACTIVE_JOB_STATUSES.has(job.status))
    .map((job) => putJob({
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
  if (!(await putJob(job))) {
    throw new Error('No se puede crear un job para un atleta que está siendo eliminado.')
  }
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

/**
 * Cancels this athlete's durable active jobs and waits for their current runs,
 * bounded because the LLM provider is not abortable yet. The cancellation puts
 * intentionally bypass canWriteForAthlete: deletion creates its tombstone
 * before calling this function and these are the only writes it still allows.
 */
export async function abortPlanGenerationForAthlete(
  athleteId: string,
  opts?: { waitMs?: number },
): Promise<void> {
  const waitMs = opts?.waitMs ?? 4000
  const jobs = await db.planGenerationJobs.where('athleteId').equals(athleteId).toArray()
  const timestamp = now()
  await Promise.all(jobs
    .filter((job) => ACTIVE_JOB_STATUSES.has(job.status))
    .map((job) => db.planGenerationJobs.put({
      ...job,
      status: 'cancelled' as const,
      completedAt: timestamp,
      heartbeatAt: timestamp,
      updatedAt: timestamp,
      lastError: 'Cancelado: el atleta está siendo eliminado.',
    })))

  const inFlight = jobs
    .map((job) => runningJobs.get(job.id))
    .filter((run): run is Promise<void> => Boolean(run))
  if (inFlight.length === 0) return

  await Promise.race([
    Promise.allSettled(inFlight),
    new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, waitMs))),
  ])
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
  if (!canWriteForAthlete(initialJob.athleteId)) return
  let job: PlanGenerationJob = initialJob

  const plan = await db.trainingPlans.get(job.planId)
  if (!plan) {
    // A job without its parent is not actionable. Do not retain or recreate an
    // orphan that getRunnablePlanGenerationJobs would pick up forever.
    await db.planGenerationJobs.delete(job.id)
    callbacks?.onError?.('No se encontró el plan asociado al job.')
    return
  }

  let weeks = await loadPlanWeeks(plan.id)
  // Se resuelve UNA sola vez y antes de generar, igual que en el worker remoto.
  // Sin esto la ruta local dejaba sus semanas sin marca, y una regeneración
  // offline degradaba a v1 —de forma permanente— un plan que ya era v2.
  const effectiveQualityVersion = resolveEffectiveRunQualityVersion({
    weeks,
    targetWeekIndexes: job.targetWeekIndexes,
    productiveVersion: PRODUCTIVE_QUALITY_VERSION,
  })
  const startedAt = job.startedAt ?? now()
  const generationMode = resolveConfiguredGenerationMode()
  const recentContext = await (plan.pendingRecalibration
    ? buildPlanBuilderRecentContext(plan, undefined, {
      asOfDate: toISO(new Date(plan.pendingRecalibration.requestedAt)),
    })
    : buildPlanBuilderRecentContext(plan)).catch(() => undefined)
  job = buildJobUpdate(job, weeks, {
    status: 'running',
    startedAt,
    completedAt: undefined,
    lastError: undefined,
  })
  if (!(await putJob(job, callbacks))) return
  if (!(await putPlanAndWeeks(buildPlanCheckpoint(plan, weeks, job), weeks, callbacks))) return

  const targetWeekIndexes = job.targetWeekIndexes ?? weeks.map((week) => week.weekIndex)
  let latestPlan = plan

  for (const weekIndex of targetWeekIndexes) {
    if (!canWriteForAthlete(job.athleteId)) return
    const freshJob = await db.planGenerationJobs.get(job.id)
    if (!freshJob || !ACTIVE_JOB_STATUSES.has(freshJob.status)) return
    job = freshJob

    const persistedPlan = await db.trainingPlans.get(plan.id)
    if (!persistedPlan) return
    latestPlan = persistedPlan
    weeks = await loadPlanWeeks(plan.id)
    const target = weeks.find((week) => week.weekIndex === weekIndex)
    if (!target) continue
    if (!job.targetWeekIndexes && isReadyWeek(target)) continue

    job = buildJobUpdate(job, weeks, { currentWeekIndex: weekIndex, status: 'running' })
    if (!(await putJob(job, callbacks))) return

    const generatingWeek: TrainingPlanWeek = {
      ...target,
      status: 'generating',
      sessions: job.targetWeekIndexes ? [] : target.sessions,
      validationIssues: [],
      generationMeta: { attempts: 0, strategy: 'single' },
      updatedAt: now(),
    }
    weeks = replaceWeek(weeks, generatingWeek)
    if (!(await putWeek(generatingWeek, callbacks))) return
    if (!(await putPlanAndWeeks(buildPlanCheckpoint(latestPlan, weeks, job), weeks, callbacks))) return

    try {
      const incrementalWrites = new Set<Promise<unknown>>()
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
        onWeekUpdate: (streamed) => {
          if (!canWriteForAthlete(job.athleteId)) return
          const next = withQualityVersion(streamed, effectiveQualityVersion)
          weeks = replaceWeek(weeks, next)
          const write = putStreamingWeek(job.athleteId, next, callbacks)
          incrementalWrites.add(write)
          void write.then(
            () => incrementalWrites.delete(write),
            () => incrementalWrites.delete(write),
          )
        },
      })
      await Promise.allSettled([...incrementalWrites])

      if (!canWriteForAthlete(job.athleteId)) return

      const generated = generatedWeeks[0]
        ? withQualityVersion(generatedWeeks[0], effectiveQualityVersion)
        : {
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
      if (!(await putWeek(generated, callbacks))) return

      const checkpointPlan = buildPlanCheckpoint(latestPlan, weeks, job)
      latestPlan = checkpointPlan
      job = buildJobUpdate(job, weeks, { currentWeekIndex: null })
      if (!(await putPlanAndWeeks(checkpointPlan, weeks, callbacks))) return
      if (!(await putJob(job, callbacks))) return
    } catch (error) {
      if (!canWriteForAthlete(job.athleteId)) return
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
      if (!(await putWeek(errored, callbacks))) return
      job = buildJobUpdate(job, weeks, {
        currentWeekIndex: null,
        lastError: message,
      })
      if (!(await putPlanAndWeeks(buildPlanCheckpoint(latestPlan, weeks, job), weeks, callbacks))) return
      if (!(await putJob(job, callbacks))) return
    }
  }

  if (!canWriteForAthlete(job.athleteId)) return
  weeks = await loadPlanWeeks(plan.id)
  const persistedPlan = await db.trainingPlans.get(plan.id)
  if (!persistedPlan) return
  const completedAt = now()
  const finalPlan = buildPlanCheckpoint(persistedPlan, weeks, job, completedAt, profile)
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

  if (!(await putPlanAndWeeks(finalPlan, weeks, callbacks))) return
  if (!(await putJob(finalJob, callbacks))) return
  if (finalJob.status === 'failed' && finalJob.lastError) {
    callbacks?.onError?.(finalJob.lastError)
  }
}
