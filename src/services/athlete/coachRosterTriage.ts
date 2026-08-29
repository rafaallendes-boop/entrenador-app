import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { Athlete, DayLog, Session, WeekSummary } from '../../types'

export const TRIAGE_THRESHOLDS = {
  painLevel: 4,
  painWindowDays: 7,
  overdueWindowDays: 14,
  noCheckInDays: 3,
  lowAdherencePct: 60,
} as const

export type TriageSignal =
  | { kind: 'pain'; days: number }
  | { kind: 'overdue-sessions'; count: number; oldestDaysAgo: number }
  | { kind: 'no-check-in'; days: number }
  | { kind: 'low-adherence'; adherencePct: number }

export interface AthleteTriage {
  athleteId: string
  signals: TriageSignal[]
  insufficientData: boolean
}

export interface AthleteTriageInput {
  athlete: Pick<Athlete, 'id' | 'createdAt'>
  today: string
  dayLogsInPainWindow: DayLog[]
  latestDayLog?: DayLog
  sessionsInWindow: Session[]
  previousWeekSummary?: WeekSummary
}

const SIGNAL_PRIORITY: Record<TriageSignal['kind'], number> = {
  pain: 0,
  'overdue-sessions': 1,
  'no-check-in': 2,
  'low-adherence': 3,
}

function calendarDaysBetween(fromISO: string, toISO: string): number {
  return differenceInCalendarDays(parseISO(toISO), parseISO(fromISO))
}

function epochToLocalCalendarDate(epoch: number): string {
  return format(new Date(epoch), 'yyyy-MM-dd')
}

function sortByPriority(signals: TriageSignal[]): TriageSignal[] {
  return signals.sort((a, b) => SIGNAL_PRIORITY[a.kind] - SIGNAL_PRIORITY[b.kind])
}

export function computeAthleteTriage(input: AthleteTriageInput): AthleteTriage {
  const signals: TriageSignal[] = []

  const painDates = new Set(
    input.dayLogsInPainWindow
      .filter((log) => {
        const daysAgo = calendarDaysBetween(log.date, input.today)
        return daysAgo >= 0
          && daysAgo < TRIAGE_THRESHOLDS.painWindowDays
          && (log.painLevel ?? 0) >= TRIAGE_THRESHOLDS.painLevel
      })
      .map((log) => log.date),
  )
  if (painDates.size > 0) {
    signals.push({ kind: 'pain', days: painDates.size })
  }

  const sessionsInWindow = input.sessionsInWindow.filter((session) => {
    const daysAgo = calendarDaysBetween(session.date, input.today)
    return daysAgo >= 1 && daysAgo <= TRIAGE_THRESHOLDS.overdueWindowDays
  })
  const overdue = sessionsInWindow.filter((session) => session.status === 'planned')
  if (overdue.length > 0) {
    const oldestDaysAgo = Math.max(
      ...overdue.map((session) => calendarDaysBetween(session.date, input.today)),
    )
    signals.push({ kind: 'overdue-sessions', count: overdue.length, oldestDaysAgo })
  }

  const referenceDate = input.latestDayLog?.date
    ?? epochToLocalCalendarDate(input.athlete.createdAt)
  const daysSinceCheckIn = calendarDaysBetween(referenceDate, input.today)
  if (daysSinceCheckIn >= TRIAGE_THRESHOLDS.noCheckInDays) {
    signals.push({ kind: 'no-check-in', days: daysSinceCheckIn })
  }

  const hasPreviousProgramming = (input.previousWeekSummary?.plannedSessions ?? 0) > 0
  const adherencePct = input.previousWeekSummary?.adherencePct
  if (
    hasPreviousProgramming
    && adherencePct != null
    && adherencePct < TRIAGE_THRESHOLDS.lowAdherencePct
  ) {
    signals.push({ kind: 'low-adherence', adherencePct })
  }

  return {
    athleteId: input.athlete.id,
    signals: sortByPriority(signals),
    insufficientData: sessionsInWindow.length === 0 && !hasPreviousProgramming,
  }
}
