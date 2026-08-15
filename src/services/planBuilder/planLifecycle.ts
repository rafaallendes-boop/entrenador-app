import type { Session } from '../../types'
import type { TrainingPlan } from '../../types/planBuilder'
import { todayISO } from '../../utils/date'
import { getActiveAthleteId, getSelfAthleteId } from '../athlete/activeAthlete'
import { isRowInActiveScope } from '../athlete/activeScopeFilter'
import { isScopedAthleteId } from '../athlete/effectiveAthleteKey'

export function getPlanLifecycleCutoff(
  nextPlan: TrainingPlan,
  today = todayISO(),
): string {
  return nextPlan.startDate > today ? nextPlan.startDate : today
}

function planBelongsToTargetAthlete(
  candidate: TrainingPlan,
  nextPlan: TrainingPlan,
): boolean {
  if (isScopedAthleteId(candidate.athleteId)) {
    return candidate.athleteId === nextPlan.athleteId
  }

  // Legacy rows belong only to self. `isRowInActiveScope` is the canonical
  // compatibility policy; the explicit target check keeps pre-hydration reads
  // from adopting legacy rows into a known managed-athlete plan.
  if (!isRowInActiveScope(candidate.athleteId)) return false
  const active = getActiveAthleteId()
  if (!active) return false
  return active === nextPlan.athleteId && active === getSelfAthleteId()
}

export function selectActivePlansToSupersede(
  plans: TrainingPlan[],
  nextPlan: TrainingPlan,
): TrainingPlan[] {
  return plans.filter((candidate) => (
    candidate.id !== nextPlan.id
    && candidate.status === 'active'
    && planBelongsToTargetAthlete(candidate, nextPlan)
  ))
}

export function stampLifecyclePlanAthlete(
  plan: TrainingPlan,
  nextPlan: TrainingPlan,
): TrainingPlan {
  return isScopedAthleteId(plan.athleteId)
    ? plan
    : { ...plan, athleteId: nextPlan.athleteId }
}

export function selectSupersededPlanSessionsForCleanup(
  sessions: Session[],
  supersededPlanIds: ReadonlySet<string>,
  cutoff: string,
): Session[] {
  if (supersededPlanIds.size === 0) return []
  return sessions.filter((session) => (
    isRowInActiveScope(session.athleteId)
    && session.status === 'planned'
    && session.source !== 'manual'
    && session.date >= cutoff
    && session.planId != null
    && supersededPlanIds.has(session.planId)
  ))
}
