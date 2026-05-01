import type { PlanGenerationState, TrainingPlanWeek } from '../../types/planBuilder'

export type PlanBuilderGenerationStrategy = 'single' | 'pairs' | 'auto'

export function derivePlanGenerationState(weeks: TrainingPlanWeek[]): PlanGenerationState {
  if (weeks.some((week) => week.status === 'generating')) return 'generating'
  if (weeks.length === 0) return 'shell'

  const readyWeeks = weeks.filter((week) => week.status === 'draft' && week.sessions.length > 0).length
  if (readyWeeks === weeks.length) return 'complete'
  if (readyWeeks > 0) return 'partial'
  if (weeks.some((week) => week.status === 'error' || (week.generationMeta.attempts ?? 0) > 0)) return 'failed'

  return 'shell'
}

export function resolveConfiguredGenerationStrategy(totalWeeks: number, requested?: 'single' | 'pairs'): 'single' | 'pairs' {
  if (requested) return requested

  const configured = (import.meta.env.VITE_PLAN_BUILDER_GENERATION_STRATEGY ?? 'single').toLowerCase()
  if (configured === 'pairs') return 'pairs'
  if (configured === 'auto') return totalWeeks >= 8 ? 'pairs' : 'single'

  return 'single'
}
