import { db } from '../../db/db'
import type {
  PlanGenerationJob,
  TrainingPlan,
  TrainingPlanWeek,
} from '../../types/planBuilder'
import {
  getActiveAthleteId,
  getSwitchEpoch,
} from '../athlete/activeAthlete'
import { filterRowsToActiveScope } from '../athlete/activeScopeFilter'
import { isScopedAthleteId } from '../athlete/effectiveAthleteKey'
import { softDeleteTrainingPlan } from '../syncService'

export type DeleteCycleResult = 'deleted' | 'pending_sync' | 'failed'

const ACTIVE_JOB_STATUSES = new Set<PlanGenerationJob['status']>(['queued', 'running'])

function scopeIsStable(athleteId: string, switchEpoch: number): boolean {
  return getActiveAthleteId() === athleteId && getSwitchEpoch() === switchEpoch
}

function normalizeRemoteScope(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  activeAthleteId: string,
): { plan: TrainingPlan; weeks: TrainingPlanWeek[] } {
  const athleteId = isScopedAthleteId(plan.athleteId) ? plan.athleteId : activeAthleteId
  return {
    plan: plan.athleteId === athleteId ? plan : { ...plan, athleteId },
    weeks: weeks.map((week) => (
      week.athleteId === athleteId ? week : { ...week, athleteId }
    )),
  }
}

/**
 * Deletes a cycle remote-first. The parent tombstone is the authoritative
 * remote commit; local rows are purged only after it was pushed (or when this
 * build has no remote at all).
 */
export async function deletePlanCycle(planId: string): Promise<DeleteCycleResult> {
  const athleteId = getActiveAthleteId()
  const switchEpoch = getSwitchEpoch()
  if (!athleteId) return 'failed'

  const plan = await db.trainingPlans.get(planId)
  if (!scopeIsStable(athleteId, switchEpoch)) return 'failed'
  if (!plan) return 'deleted'
  if (filterRowsToActiveScope([plan]).length !== 1) return 'failed'

  const [weeks, jobs] = await Promise.all([
    db.trainingPlanWeeks.where('planId').equals(planId).toArray(),
    db.planGenerationJobs.where('planId').equals(planId).toArray(),
  ])
  if (!scopeIsStable(athleteId, switchEpoch)) return 'failed'
  if (jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))) return 'failed'

  const remote = normalizeRemoteScope(plan, weeks, athleteId)
  if (!scopeIsStable(athleteId, switchEpoch)) return 'failed'

  const outcome = await softDeleteTrainingPlan(remote.plan, remote.weeks)
    .catch(() => 'failed' as const)
  if (outcome === 'queued') return 'pending_sync'
  if (outcome === 'failed') return 'failed'

  await db.transaction(
    'rw',
    db.trainingPlans,
    db.trainingPlanWeeks,
    db.planGenerationJobs,
    async () => {
      await db.trainingPlanWeeks.where('planId').equals(planId).delete()
      await db.planGenerationJobs.where('planId').equals(planId).delete()
      await db.trainingPlans.delete(planId)
    },
  )

  return 'deleted'
}
