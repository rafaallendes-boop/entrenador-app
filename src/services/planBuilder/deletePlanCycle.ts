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
import {
  pushTrainingPlan,
  pushTrainingPlanWeeks,
} from '../syncService'

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
 * Removes a cycle from the plan-builder history while keeping its generated
 * weeks. Weeks are children of a plan in the remote schema, so deleting the
 * parent would cascade and lose them. A superseded parent is therefore kept
 * as an invisible container for those weeks.
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

  const retainedPlan: TrainingPlan = {
    ...remote.plan,
    status: 'superseded',
    updatedAt: Math.max(Date.now(), remote.plan.updatedAt + 1),
  }

  // Commit the parent first so the remote foreign-key container exists before
  // its weeks are uploaded. Offline writes are queued by the sync layer.
  await pushTrainingPlan(retainedPlan).catch(() => undefined)

  await db.transaction(
    'rw',
    db.trainingPlans,
    db.trainingPlanWeeks,
    db.planGenerationJobs,
    async () => {
      await db.planGenerationJobs.where('planId').equals(planId).delete()
      await db.trainingPlans.put(retainedPlan)
    },
  )

  // Keep the parent remote row alive because training_plan_weeks has a
  // foreign key to it.
  await pushTrainingPlanWeeks(retainedPlan, remote.weeks).catch(() => undefined)

  return 'deleted'
}
