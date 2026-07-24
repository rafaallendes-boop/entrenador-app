import { differenceInCalendarDays } from 'date-fns'
import type { WeekSummary } from '../../types'
import type { TrainingPlan } from '../../types/planBuilder'
import { fromISO } from '../../utils/date'

export type PlanCycleState = 'upcoming' | 'post_event'

export interface CycleSummary {
  weeksTrained: number
  avgAdherence: number | null
}

/**
 * Total order used whenever several rows can represent the same event.
 * A negative value means `a` is the canonical (more recent) candidate.
 */
export function comparePlanCanonicalRecency(a: TrainingPlan, b: TrainingPlan): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt

  if (a.acceptedAt == null && b.acceptedAt != null) return 1
  if (a.acceptedAt != null && b.acceptedAt == null) return -1
  if (a.acceptedAt != null && b.acceptedAt != null && a.acceptedAt !== b.acceptedAt) {
    return b.acceptedAt - a.acceptedAt
  }

  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/**
 * The event date itself still belongs to the cycle. Post-event begins on the
 * following calendar day, independently of elapsed hours across DST changes.
 */
export function resolvePlanCycleState(args: {
  eventDateISO: string
  todayISO: string
}): PlanCycleState {
  const daysToEvent = differenceInCalendarDays(
    fromISO(args.eventDateISO),
    fromISO(args.todayISO),
  )
  return daysToEvent < 0 ? 'post_event' : 'upcoming'
}

/**
 * Summarizes only the real weeks persisted for a plan. A plan's start date may
 * precede its first scheduled training week, so deriving this set from a date
 * interval would shift the summary for sparse schedules.
 */
export function summarizeCycle(args: {
  weekStartDates: string[]
  weekSummaries: WeekSummary[]
}): CycleSummary {
  const planWeeks = new Set(args.weekStartDates)
  const inCycle = args.weekSummaries.filter((summary) => planWeeks.has(summary.weekStartDate))

  const weeksTrained = inCycle.filter((summary) => summary.completedSessions > 0).length
  const adherences = inCycle
    .map((summary) => summary.adherencePct)
    .filter((adherence): adherence is number => adherence != null)

  return {
    weeksTrained,
    avgAdherence: adherences.length > 0
      ? Math.round(adherences.reduce((sum, adherence) => sum + adherence, 0) / adherences.length)
      : null,
  }
}
