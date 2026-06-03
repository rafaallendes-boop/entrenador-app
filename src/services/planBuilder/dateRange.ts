import type { DayOfWeek, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

const DAY_MS = 24 * 60 * 60 * 1000

function dateToUtcMs(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getTime()
}

function utcMsToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function getPlanWeekDateRange(plan: TrainingPlan, week: TrainingPlanWeek): { startDate: string; endDate: string } {
  const weekStart = dateToUtcMs(week.weekStartDate)
  const weekEnd = weekStart + 6 * DAY_MS
  const planStart = dateToUtcMs(plan.startDate)
  const planEnd = dateToUtcMs(plan.endDate)

  const start = Math.max(weekStart, planStart)
  const end = Math.min(weekEnd, planEnd)

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return {
      startDate: week.weekStartDate,
      endDate: utcMsToDate(weekEnd),
    }
  }

  return {
    startDate: utcMsToDate(start),
    endDate: utcMsToDate(end),
  }
}

export function isDateInsidePlanWeekRange(date: string, plan: TrainingPlan, week: TrainingPlanWeek): boolean {
  const { startDate, endDate } = getPlanWeekDateRange(plan, week)
  return date >= startDate && date <= endDate
}

function isoDateToDayOfWeek(date: string): DayOfWeek | null {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  const mapping: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return mapping[parsed.getUTCDay()] ?? null
}

function canUseDoubleSessionOnDate(date: string, wizardConfig: PlanWizardConfig): boolean {
  if (!wizardConfig.allowDoubleSession) return false
  const doubleDays = wizardConfig.doubleSessionDays
  if (!doubleDays || doubleDays.length === 0) return true
  const day = isoDateToDayOfWeek(date)
  return Boolean(day && doubleDays.includes(day))
}

export function getPlanWeekTrainingDates(plan: TrainingPlan, week: TrainingPlanWeek): string[] {
  const { startDate, endDate } = getPlanWeekDateRange(plan, week)
  const allowedDays = new Set(plan.wizardConfig.trainingDays)
  const dates: string[] = []

  for (let ts = dateToUtcMs(startDate); ts <= dateToUtcMs(endDate); ts += DAY_MS) {
    const iso = utcMsToDate(ts)
    const day = isoDateToDayOfWeek(iso)
    if (day && allowedDays.has(day)) {
      dates.push(iso)
    }
  }

  return dates
}

export function getPlanWeekSessionCapacity(plan: TrainingPlan, week: TrainingPlanWeek): number {
  return getPlanWeekTrainingDates(plan, week).reduce((total, date) => {
    return total + (canUseDoubleSessionOnDate(date, plan.wizardConfig) ? 2 : 1)
  }, 0)
}

export function getExpectedSessionsForPlanWeek(plan: TrainingPlan, week: TrainingPlanWeek): number {
  const baseExpected = Math.min(plan.wizardConfig.sessionsPerWeek, getPlanWeekSessionCapacity(plan, week))
  if (baseExpected <= 0) return 0
  if (week.phase !== 'taper' && week.phase !== 'race') return baseExpected

  const daysToEventFromWeekStart = Math.round((dateToUtcMs(plan.endDate) - dateToUtcMs(getPlanWeekDateRange(plan, week).startDate)) / DAY_MS)
  if (week.phase === 'race') return Math.min(baseExpected, 2)
  if (daysToEventFromWeekStart <= 13) return Math.min(baseExpected, 4)
  if (daysToEventFromWeekStart <= 20) return Math.min(baseExpected, Math.max(3, plan.wizardConfig.sessionsPerWeek - 2))
  if (daysToEventFromWeekStart <= 27) return Math.min(baseExpected, Math.max(4, plan.wizardConfig.sessionsPerWeek - 1))
  return Math.min(baseExpected, Math.max(4, plan.wizardConfig.sessionsPerWeek - 1))
}
