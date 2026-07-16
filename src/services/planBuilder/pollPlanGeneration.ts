import { db } from '../../db/db'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { supabase } from '../auth'
import { rowToTrainingPlan, rowToTrainingPlanWeek } from './planRows'
import { countReadyWeeks, sortWeeks } from './weekUtils'
import { runAthleteWrite } from '../sync/athleteWriteLease'

export interface PlanGenerationSnapshot {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  isTerminal: boolean
  isStalled: boolean
}

export interface PollPlanGenerationInput {
  planId: string
  intervalMs?: number
  stalledAfterMs?: number
  signal?: AbortSignal
  onSnapshot?: (snapshot: PlanGenerationSnapshot) => void
  /** @internal For testing only — overrides fetchPlanGenerationSnapshot */
  _fetchFn?: (planId: string, options?: { stalledAfterMs?: number }) => Promise<PlanGenerationSnapshot | null>
}

const DEFAULT_INTERVAL_MS = 4_000
// El worker puede pasar hasta ~2 intentos de 120s en una semana antes de
// refrescar heartbeat entre intentos; 5 min evita marcar "stalled" en falso.
const DEFAULT_STALLED_AFTER_MS = 5 * 60_000
const TERMINAL_STATES = new Set<TrainingPlan['generationState']>(['complete', 'partial', 'failed', 'cancelled'])

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Polling abortado.'))
      return
    }
    const timeout = globalThis.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timeout)
      reject(new Error('Polling abortado.'))
    }, { once: true })
  })
}

export function derivePollingSnapshot(plan: TrainingPlan, weeks: TrainingPlanWeek[], now = Date.now(), stalledAfterMs = DEFAULT_STALLED_AFTER_MS): PlanGenerationSnapshot {
  // Fall back to startedAt when the background function hasn't written a heartbeat yet.
  const heartbeatAt = plan.generationSummary?.heartbeatAt ?? plan.generationSummary?.startedAt
  const isTerminal = TERMINAL_STATES.has(plan.generationState)
  const isStalled = plan.generationState === 'generating'
    && typeof heartbeatAt === 'number'
    && now - heartbeatAt > stalledAfterMs
  return { plan, weeks: sortWeeks(weeks), isTerminal, isStalled }
}

function failedWeekIndexes(weeks: TrainingPlanWeek[]): number[] {
  return weeks
    .filter((week) => week.status === 'error')
    .map((week) => week.weekIndex)
    .sort((a, b) => a - b)
}

function hasRemoteWeekProgress(weeks: TrainingPlanWeek[]): boolean {
  return weeks.some((week) =>
    week.status !== 'pending' ||
    week.sessions.length > 0 ||
    (week.generationMeta.attempts ?? 0) > 0
  )
}

function derivePlanStateFromWeeks(plan: TrainingPlan, weeks: TrainingPlanWeek[]): TrainingPlan['generationState'] {
  if (weeks.length === 0) return plan.generationState
  if (weeks.some((week) => week.status === 'generating')) return 'generating'
  const readyWeeks = countReadyWeeks(weeks)
  if (weeks.some((week) => week.status === 'pending' || week.status === 'regenerating')) {
    return plan.generationState === 'generating' || hasRemoteWeekProgress(weeks)
      ? 'generating'
      : plan.generationState
  }
  if (readyWeeks === weeks.length) return 'complete'
  if (readyWeeks > 0) return 'partial'
  if (weeks.some((week) => week.status === 'error' || (week.generationMeta.attempts ?? 0) > 0)) return 'failed'
  return plan.generationState
}

function mergePlanWithRemoteWeeks(
  basePlan: TrainingPlan,
  remoteWeeks: TrainingPlanWeek[],
  now: number,
): TrainingPlan {
  const sortedWeeks = sortWeeks(remoteWeeks)
  const heartbeatAt = Math.max(
    basePlan.generationSummary?.heartbeatAt ?? basePlan.generationSummary?.startedAt ?? basePlan.updatedAt ?? now,
    ...sortedWeeks.map((week) => week.updatedAt ?? 0),
  )
  const generationState = derivePlanStateFromWeeks(basePlan, sortedWeeks)
  const completedAt = generationState === 'complete' || generationState === 'partial' || generationState === 'failed'
    ? now
    : basePlan.generationSummary?.completedAt

  return {
    ...basePlan,
    generationState,
    updatedAt: Math.max(basePlan.updatedAt ?? 0, heartbeatAt),
    generationSummary: {
      ...(basePlan.generationSummary ?? {
        startedAt: now,
        strategy: 'single' as const,
        completedWeeks: 0,
        failedWeeks: [],
        totalAttempts: 0,
      }),
      completedAt,
      completedWeeks: countReadyWeeks(sortedWeeks),
      failedWeeks: failedWeekIndexes(sortedWeeks),
      totalAttempts: sortedWeeks.reduce((sum, week) => sum + (week.generationMeta.attempts ?? 0), 0),
      heartbeatAt,
    },
  }
}

export async function fetchPlanGenerationSnapshot(
  planId: string,
  options?: { stalledAfterMs?: number; now?: number },
): Promise<PlanGenerationSnapshot | null> {
  if (!supabase) return null

  const [{ data: planRow, error: planError }, { data: weekRows, error: weeksError }] = await Promise.all([
    supabase.from('training_plans').select('*').eq('id', planId).maybeSingle(),
    supabase.from('training_plan_weeks').select('*').eq('plan_id', planId),
  ])
  if (planError) throw planError
  if (weeksError) throw weeksError
  if (!planRow) return null

  const plan = rowToTrainingPlan(planRow as Record<string, unknown>)
  const weeks = ((weekRows ?? []) as Record<string, unknown>[]).map(rowToTrainingPlanWeek)
  const localPlan = await db.trainingPlans.get(planId)
  const localWeeks = localPlan
    ? await db.trainingPlanWeeks.where('planId').equals(planId).toArray()
    : []

  const now = options?.now ?? Date.now()
  if (localPlan && shouldKeepLocalGenerationSnapshot(localPlan, plan, weeks)) {
    return derivePollingSnapshot(
      localPlan,
      localWeeks.length > 0 ? localWeeks : weeks,
      now,
      options?.stalledAfterMs,
    )
  }

  const snapshot = plan.generationState === 'shell' &&
    hasRemoteWeekProgress(weeks)
    ? derivePollingSnapshot(
      mergePlanWithRemoteWeeks(localPlan?.generationState === 'generating' ? localPlan : plan, weeks, now),
      weeks,
      now,
      options?.stalledAfterMs,
    )
    : derivePollingSnapshot(plan, weeks, now, options?.stalledAfterMs)

  const wrote = await runAthleteWrite(snapshot.plan.athleteId, () =>
    db.transaction('rw', db.trainingPlans, db.trainingPlanWeeks, async () => {
      await db.trainingPlans.put(snapshot.plan)
      await db.trainingPlanWeeks.bulkPut(snapshot.weeks)
    }))
  if (!wrote) return null

  return snapshot
}

export function shouldKeepLocalGenerationSnapshot(
  localPlan: TrainingPlan | undefined,
  remotePlan: TrainingPlan,
  remoteWeeks: TrainingPlanWeek[] = [],
): boolean {
  if (!localPlan) return false
  if (localPlan.id !== remotePlan.id) return false
  if (localPlan.generationState !== 'generating') return false
  if (remotePlan.generationState !== 'shell') return false
  if (hasRemoteWeekProgress(remoteWeeks)) return false
  return (remotePlan.updatedAt ?? 0) <= (localPlan.updatedAt ?? 0)
}

export async function pollPlanGeneration(input: PollPlanGenerationInput): Promise<PlanGenerationSnapshot | null> {
  let latest: PlanGenerationSnapshot | null = null
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS
  const doFetch = input._fetchFn ?? fetchPlanGenerationSnapshot

  while (!input.signal?.aborted) {
    latest = await doFetch(input.planId, {
      stalledAfterMs: input.stalledAfterMs,
    })
    if (input.signal?.aborted) break  // guard: abort pudo ocurrir durante el await
    if (latest) {
      input.onSnapshot?.(latest)
      if (latest.isTerminal || latest.isStalled) return latest
    }
    await sleep(intervalMs, input.signal)
  }

  return latest
}
