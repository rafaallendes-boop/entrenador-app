import type { DayOfWeek } from '../../types'
import type { WeekCreatorEffectiveConfig } from './WeekCreatorConfig'

const DAY_MAPPING: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export interface WeekCreatorDateWindow {
  targetWeekStart: string
  planningStartDate: string
  weekEndDate: string
  isPartialCurrentWeek: boolean
}

export function resolveWeekCreatorDateWindow(
  targetWeekStart: string,
  today: string,
): WeekCreatorDateWindow {
  const weekEndDate = addDaysIso(targetWeekStart, 6)
  const isPartialCurrentWeek = isStrictISODate(today)
    && today > targetWeekStart
    && today <= weekEndDate

  return {
    targetWeekStart,
    planningStartDate: isPartialCurrentWeek ? today : targetWeekStart,
    weekEndDate,
    isPartialCurrentWeek,
  }
}

export function applyWeekCreatorDateWindowToConfig(
  config: WeekCreatorEffectiveConfig,
  window: WeekCreatorDateWindow,
): WeekCreatorEffectiveConfig {
  if (!window.isPartialCurrentWeek) return config

  const remainingDays = filterDaysInsideWindow(config.trainingDays, window)
  const trainingDays = remainingDays.length > 0
    ? remainingDays
    : ([isoDateToDayOfWeek(window.planningStartDate)].filter(Boolean) as DayOfWeek[])
  const trainingDaySet = new Set(trainingDays)
  const configuredDoubleDays = (config.doubleSessionDays ?? []).filter((day) => trainingDaySet.has(day))
  const doubleSessionDays = config.allowDoubleSession
    ? configuredDoubleDays.length > 0 ? configuredDoubleDays : trainingDays
    : []
  const remainingCapacity = trainingDays.length + (config.allowDoubleSession ? doubleSessionDays.length : 0)
  const maxSessionsPerWeek = Math.max(1, Math.min(config.maxSessionsPerWeek, remainingCapacity || 1))
  const sessionsPerWeek = Math.max(1, Math.min(config.sessionsPerWeek, maxSessionsPerWeek))
  const partialNote = `Semana parcial: planificar solo desde ${window.planningStartDate} hasta ${window.weekEndDate}; no usar días pasados de esta semana.`

  return {
    ...config,
    trainingDays,
    doubleSessionDays,
    sessionsPerWeek,
    maxSessionsPerWeek,
    scheduleConstraints: [config.scheduleConstraints, partialNote].filter(Boolean).join(' '),
  }
}

export function addDaysIso(date: string, days: number): string {
  const start = new Date(`${date}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() + days)
  return start.toISOString().slice(0, 10)
}

export function isoDateToDayOfWeek(date: string): DayOfWeek | null {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return DAY_MAPPING[parsed.getUTCDay()] ?? null
}

function filterDaysInsideWindow(
  days: DayOfWeek[],
  window: WeekCreatorDateWindow,
): DayOfWeek[] {
  return days.filter((day) => {
    const date = addDaysIso(window.targetWeekStart, dayOffset(day))
    return date >= window.planningStartDate && date <= window.weekEndDate
  })
}

function dayOffset(day: DayOfWeek): number {
  const offsets: Record<DayOfWeek, number> = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4,
    saturday: 5,
    sunday: 6,
  }
  return offsets[day]
}

function isStrictISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}
