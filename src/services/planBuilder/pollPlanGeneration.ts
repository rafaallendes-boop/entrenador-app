import { db } from '../../db/db'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { supabase } from '../auth'
import { rowToTrainingPlan, rowToTrainingPlanWeek } from './planRows'

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
}

const DEFAULT_INTERVAL_MS = 4_000
const DEFAULT_STALLED_AFTER_MS = 3 * 60_000
const TERMINAL_STATES = new Set<TrainingPlan['generationState']>(['complete', 'partial', 'failed', 'cancelled'])

function sortWeeks(weeks: TrainingPlanWeek[]): TrainingPlanWeek[] {
  return [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)
}

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
  const heartbeatAt = plan.generationSummary?.heartbeatAt
  const isTerminal = TERMINAL_STATES.has(plan.generationState)
  const isStalled = plan.generationState === 'generating'
    && typeof heartbeatAt === 'number'
    && now - heartbeatAt > stalledAfterMs
  return { plan, weeks: sortWeeks(weeks), isTerminal, isStalled }
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
  const snapshot = derivePollingSnapshot(plan, weeks, options?.now ?? Date.now(), options?.stalledAfterMs)

  await db.transaction('rw', db.trainingPlans, db.trainingPlanWeeks, async () => {
    await db.trainingPlans.put(snapshot.plan)
    await db.trainingPlanWeeks.bulkPut(snapshot.weeks)
  })

  return snapshot
}

export async function pollPlanGeneration(input: PollPlanGenerationInput): Promise<PlanGenerationSnapshot | null> {
  let latest: PlanGenerationSnapshot | null = null
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS

  while (!input.signal?.aborted) {
    latest = await fetchPlanGenerationSnapshot(input.planId, {
      stalledAfterMs: input.stalledAfterMs,
    })
    if (latest) {
      input.onSnapshot?.(latest)
      if (latest.isTerminal || latest.isStalled) return latest
    }
    await sleep(intervalMs, input.signal)
  }

  return latest
}
