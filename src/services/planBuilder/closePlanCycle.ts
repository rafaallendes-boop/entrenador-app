import { db } from '../../db/db'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import {
  getActiveAthleteId,
  getSwitchEpoch,
} from '../athlete/activeAthlete'
import { filterRowsToActiveScope } from '../athlete/activeScopeFilter'
import { isScopedAthleteId } from '../athlete/effectiveAthleteKey'
import {
  archiveTrainingPlan,
  pushTrainingPlan,
  pushTrainingPlanWeeks,
} from '../syncService'
import { comparePlanCanonicalRecency } from './planCycle'

interface ClosePlanCycleArgs {
  goalEventId: string
}

function scopeIsStable(athleteId: string, switchEpoch: number): boolean {
  return getActiveAthleteId() === athleteId && getSwitchEpoch() === switchEpoch
}

function planForAthlete(plan: TrainingPlan, athleteId: string): TrainingPlan {
  return isScopedAthleteId(plan.athleteId) ? plan : { ...plan, athleteId }
}

function weeksForPlanScope(
  weeks: TrainingPlanWeek[],
  plan: TrainingPlan,
): TrainingPlanWeek[] {
  return weeks.map((week) => (
    week.athleteId === plan.athleteId ? week : { ...week, athleteId: plan.athleteId }
  ))
}

/**
 * Archives the active rows for one explicit event in the hydrated athlete
 * scope. The total comparator makes the canonical row deterministic across
 * devices; duplicate rows for that event become superseded.
 */
export async function closePlanCycle({ goalEventId }: ClosePlanCycleArgs): Promise<void> {
  const athleteId = getActiveAthleteId()
  const switchEpoch = getSwitchEpoch()
  if (!athleteId || !goalEventId) return

  // Select and mutate in the same Dexie transaction. A plan inserted between an
  // earlier snapshot and this commit must participate in the canonicalization.
  const updates = await db.transaction('rw', db.trainingPlans, async () => {
    if (!scopeIsStable(athleteId, switchEpoch)) return false

    const candidates = filterRowsToActiveScope(await db.trainingPlans.toArray())
      .filter((plan) => plan.status === 'active' && plan.goalEventId === goalEventId)
      .sort(comparePlanCanonicalRecency)
    if (!scopeIsStable(athleteId, switchEpoch)) return false
    if (candidates.length === 0) return []

    const mutationTimestamp = Math.max(
      Date.now(),
      ...candidates.map((plan) => plan.updatedAt + 1),
    )
    const [canonical, ...duplicates] = candidates
    const archived = {
      ...planForAthlete(canonical, athleteId),
      status: 'archived' as const,
      updatedAt: mutationTimestamp,
    }
    const superseded = duplicates.map((plan) => ({
      ...planForAthlete(plan, athleteId),
      status: 'superseded' as const,
      updatedAt: mutationTimestamp,
    }))
    const updates = [archived, ...superseded]
    await db.trainingPlans.bulkPut(updates)
    return updates
  })
  if (updates === false || updates.length === 0) return

  const [archived, ...superseded] = updates
  const weekEntries = await Promise.all(updates.map(async (plan) => {
    const weeks = await db.trainingPlanWeeks.where('planId').equals(plan.id).toArray()
    return [plan.id, weeksForPlanScope(weeks, plan)] as const
  }))
  if (!scopeIsStable(athleteId, switchEpoch)) return
  const weeksByPlanId = new Map(weekEntries)

  await archiveTrainingPlan(archived, weeksByPlanId.get(archived.id) ?? [])
    .catch(() => undefined)

  for (const plan of superseded) {
    if (!scopeIsStable(athleteId, switchEpoch)) return
    const weeks = weeksByPlanId.get(plan.id) ?? []
    await pushTrainingPlan(plan).catch(() => undefined)
    if (!scopeIsStable(athleteId, switchEpoch)) return
    await pushTrainingPlanWeeks(plan, weeks).catch(() => undefined)
  }
}
