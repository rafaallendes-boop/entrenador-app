import type { DayOfWeek, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import {
  MAX_EVENT_WINDOW_SUPPORTS_PER_WEEK,
  isWithinPlanEventWindow,
  planWeekContainsEventAnchor,
  resolvePlanEventWindow,
} from './eventWindowRules'

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

function daysFromWeekStartToPlanEnd(plan: TrainingPlan, week: TrainingPlanWeek): number {
  return Math.round(
    (dateToUtcMs(plan.endDate) - dateToUtcMs(getPlanWeekDateRange(plan, week).startDate)) / DAY_MS,
  )
}

/** Mismo escalonado que usa la fase taper, reutilizado por los días de la
 * semana race que quedan fuera de la ventana del campeonato. */
function taperWeekCap(plan: TrainingPlan, week: TrainingPlanWeek): number {
  const days = daysFromWeekStartToPlanEnd(plan, week)
  if (days <= 13) return 4
  if (days <= 20) return Math.max(3, plan.wizardConfig.sessionsPerWeek - 2)
  return Math.max(4, plan.wizardConfig.sessionsPerWeek - 1)
}

export function getExpectedSessionsForPlanWeek(plan: TrainingPlan, week: TrainingPlanWeek): number {
  let capacity = getPlanWeekSessionCapacity(plan, week)
  const primarySport = plan.macroSnapshot.sportDetails.find((detail) => detail.role === 'primary')?.sport
  if (week.phase === 'race' && primarySport === 'squash' && planWeekContainsEventAnchor(plan, week)) {
    const anchorDate = resolvePlanEventWindow(plan).anchorDate
    const anchorAlreadyUsesTrainingCapacity = getPlanWeekTrainingDates(plan, week).includes(anchorDate)
    if (!anchorAlreadyUsesTrainingCapacity) capacity += 1
  }

  const baseExpected = Math.min(plan.wizardConfig.sessionsPerWeek, capacity)
  if (baseExpected <= 0) return 0
  if (week.phase !== 'taper' && week.phase !== 'race') return baseExpected

  const daysToEventFromWeekStart = daysFromWeekStartToPlanEnd(plan, week)
  if (week.phase === 'race') {
    if (primarySport !== 'squash') return Math.min(baseExpected, 2)

    // El cupo se parte en dos: los días del evento admiten una sola ancla y
    // hasta dos apoyos; los días de la semana que quedan fuera de la ventana
    // conservan su capacidad normal y sus reglas de taper.
    const trainingDates = getPlanWeekTrainingDates(plan, week)
    const insideWindow = trainingDates.filter((date) => isWithinPlanEventWindow(plan, date))
    const outsideWindow = trainingDates.filter((date) => !isWithinPlanEventWindow(plan, date))

    const capacityOf = (dates: string[]) => dates.reduce(
      (total, date) => total + (canUseDoubleSessionOnDate(date, plan.wizardConfig) ? 2 : 1),
      0,
    )
    const anchorInWeek = planWeekContainsEventAnchor(plan, week)

    // Dentro: una sola ancla y hasta dos apoyos, medidos en capacidad y no en
    // fechas, para que un día con doble sesión pueda alojar ancla + apoyo.
    const insideAllowance = Math.min(
      capacityOf(insideWindow),
      (anchorInWeek ? 1 : 0) + MAX_EVENT_WINDOW_SUPPORTS_PER_WEEK,
    )
    // Fuera: los días previos al campeonato son taper, no una semana normal.
    const outsideAllowance = Math.min(capacityOf(outsideWindow), taperWeekCap(plan, week))

    return Math.min(baseExpected, insideAllowance + outsideAllowance)
  }
  if (daysToEventFromWeekStart <= 13) return Math.min(baseExpected, 4)
  if (daysToEventFromWeekStart <= 20) return Math.min(baseExpected, Math.max(3, plan.wizardConfig.sessionsPerWeek - 2))
  if (daysToEventFromWeekStart <= 27) return Math.min(baseExpected, Math.max(4, plan.wizardConfig.sessionsPerWeek - 1))
  return Math.min(baseExpected, Math.max(4, plan.wizardConfig.sessionsPerWeek - 1))
}
