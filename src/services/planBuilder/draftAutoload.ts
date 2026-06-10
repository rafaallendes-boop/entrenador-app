import type { TrainingPlan } from '../../types/planBuilder'

export function shouldLoadMatchingDraftPlan(plan: TrainingPlan, weekCount: number): boolean {
  return weekCount > 0 || plan.generationState !== 'shell'
}

export function shouldDeleteEmptyShellDraft(plan: TrainingPlan, weekCount: number): boolean {
  return weekCount === 0 && plan.status === 'draft' && plan.generationState === 'shell'
}
