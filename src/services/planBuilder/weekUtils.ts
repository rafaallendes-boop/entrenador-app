import type { TrainingPlanWeek } from '../../types/planBuilder'

export function isReadyWeek(week: TrainingPlanWeek): boolean {
  return (week.status === 'draft' || week.status === 'accepted') && week.sessions.length > 0
}

export function countReadyWeeks(weeks: TrainingPlanWeek[]): number {
  return weeks.filter(isReadyWeek).length
}

export function sortWeeks(weeks: TrainingPlanWeek[]): TrainingPlanWeek[] {
  return [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)
}
