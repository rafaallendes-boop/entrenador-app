import type { PlanGenerationState, TrainingPlanWeek } from '../../types/planBuilder'

export type PlanBuilderGenerationStrategy = 'single' | 'pairs'
export type PlanBuilderGenerationMode = 'deterministic' | 'hybrid'

export function derivePlanGenerationState(weeks: TrainingPlanWeek[]): PlanGenerationState {
  if (weeks.some((week) => week.status === 'generating')) return 'generating'
  if (weeks.length === 0) return 'shell'

  const readyWeeks = weeks.filter((week) => week.status === 'draft' && week.sessions.length > 0).length
  if (readyWeeks === weeks.length) return 'complete'
  if (readyWeeks > 0) return 'partial'
  if (weeks.some((week) => week.status === 'error' || (week.generationMeta.attempts ?? 0) > 0)) return 'failed'

  return 'shell'
}

export function resolveConfiguredGenerationStrategy(_totalWeeks: number, requested?: 'single' | 'pairs'): 'single' | 'pairs' {
  if (requested) return requested

  const configured = (import.meta.env.VITE_PLAN_BUILDER_STRATEGY ?? '').toLowerCase()
  if (configured === 'pairs') return 'pairs'

  return 'single'
}

export function resolveConfiguredGenerationMode(requested?: PlanBuilderGenerationMode): PlanBuilderGenerationMode {
  if (requested) return requested

  const configured = (import.meta.env.VITE_PLAN_BUILDER_GENERATION_MODE ?? '').toLowerCase()
  if (configured === 'hybrid' || configured === 'ai') return 'hybrid'

  return 'deterministic'
}

export function shouldUseDeterministicPrimary(mode: PlanBuilderGenerationMode): boolean {
  return mode === 'deterministic'
}
