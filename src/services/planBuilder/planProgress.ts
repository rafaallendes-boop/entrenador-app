import { differenceInCalendarWeeks } from 'date-fns'
import { fromISO, getWeekStart, toISO } from '../../utils/date'

interface ResolvePlanWeekNumberInput {
  planStartDate?: string
  totalWeeks: number
  dateISO: string
}

interface ResolveCurrentPlanWeekNumberInput extends ResolvePlanWeekNumberInput {
  weeksRemaining?: number
}

interface ResolvePlanStartDateInput {
  planStartDate?: string
  createdAt?: string
}

function validDate(value: Date): Date | null {
  return Number.isNaN(value.getTime()) ? null : value
}

function clampWeek(value: number, totalWeeks: number): number {
  const upper = Math.max(1, totalWeeks)
  return Math.max(1, Math.min(upper, value))
}

export function resolvePlanStartDate(input: ResolvePlanStartDateInput): string | undefined {
  if (input.planStartDate) return input.planStartDate
  if (!input.createdAt) return undefined

  const created = validDate(fromISO(input.createdAt))
  if (!created) return undefined

  return toISO(getWeekStart(created))
}

export function resolvePlanWeekNumber(input: ResolvePlanWeekNumberInput): number {
  const { planStartDate, totalWeeks, dateISO } = input
  if (!planStartDate) return clampWeek(1, totalWeeks)

  const start = validDate(fromISO(planStartDate))
  const date = validDate(fromISO(dateISO))
  if (!start || !date) return clampWeek(1, totalWeeks)

  const weekOffset = differenceInCalendarWeeks(
    getWeekStart(date),
    getWeekStart(start),
    { weekStartsOn: 1 },
  )

  return clampWeek(weekOffset + 1, totalWeeks)
}

export function resolveCurrentPlanWeekNumber(input: ResolveCurrentPlanWeekNumberInput): number {
  const { planStartDate, totalWeeks, dateISO, weeksRemaining } = input
  if (planStartDate) {
    return resolvePlanWeekNumber({ planStartDate, totalWeeks, dateISO })
  }

  if (weeksRemaining != null) {
    return clampWeek(totalWeeks - weeksRemaining, totalWeeks)
  }

  return clampWeek(1, totalWeeks)
}
