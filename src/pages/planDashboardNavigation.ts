import { ROUTES } from '../constants/routes'
import type { TrainingPlan } from '../types/planBuilder'

export function resolveGeneratedWeeksRoute(activeGeneratedPlan: Pick<TrainingPlan, 'status'> | null): string {
  return activeGeneratedPlan?.status === 'active'
    ? ROUTES.WEEK
    : ROUTES.PLAN_BUILDER_V2
}
