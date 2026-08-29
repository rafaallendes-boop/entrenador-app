import { describe, expect, it } from 'vitest'
import type { DayLog, Session, WeekSummary } from '../../../types'
import { computeAthleteTriage, type AthleteTriageInput } from '../coachRosterTriage'

const TODAY = '2026-08-29'

function dayLog(partial: Partial<DayLog>): DayLog {
  return {
    id: 'log',
    date: TODAY,
    updatedAt: 1,
    ...partial,
  }
}

function session(partial: Partial<Session>): Session {
  return {
    id: 'session',
    date: '2026-08-28',
    timeBlock: 'AM',
    type: 'squash',
    status: 'planned',
    title: 'Sesión',
    durationMin: 60,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  } as Session
}

function summary(partial: Partial<WeekSummary>): WeekSummary {
  return {
    id: 'summary',
    weekStartDate: '2026-08-17',
    totalSessions: 0,
    totalMinutes: 0,
    plannedSessions: 0,
    completedSessions: 0,
    plannedMinutes: 0,
    completedMinutes: 0,
    squashSessions: 0,
    runningSessions: 0,
    strengthSessions: 0,
    ...partial,
  }
}

function input(overrides: Partial<AthleteTriageInput> = {}): AthleteTriageInput {
  return {
    athlete: { id: 'athlete', createdAt: new Date(2026, 7, 29, 12).getTime() },
    today: TODAY,
    dayLogsInPainWindow: [],
    latestDayLog: dayLog({}),
    sessionsInWindow: [],
    previousWeekSummary: undefined,
    ...overrides,
  }
}

describe('computeAthleteTriage', () => {
  it('pain.days cuenta fechas distintas, no registros', () => {
    const result = computeAthleteTriage(input({
      dayLogsInPainWindow: [
        dayLog({ id: '1', date: '2026-08-27', painLevel: 5 }),
        dayLog({ id: '2', date: '2026-08-27', painLevel: 6 }),
        dayLog({ id: '3', date: '2026-08-25', painLevel: 4 }),
      ],
    }))

    expect(result.signals).toContainEqual({ kind: 'pain', days: 2 })
  })

  it('painLevel 3 no dispara y 4 sí, sólo dentro de siete días calendario', () => {
    const result = computeAthleteTriage(input({
      dayLogsInPainWindow: [
        dayLog({ id: 'below', date: '2026-08-29', painLevel: 3 }),
        dayLog({ id: 'edge', date: '2026-08-23', painLevel: 4 }),
        dayLog({ id: 'outside', date: '2026-08-22', painLevel: 10 }),
      ],
    }))

    expect(result.signals).toContainEqual({ kind: 'pain', days: 1 })
  })

  it('overdue cuenta sólo planned anterior a hoy dentro de catorce días', () => {
    const result = computeAthleteTriage(input({
      sessionsInWindow: [
        session({ id: 'day-14', date: '2026-08-15' }),
        session({ id: 'day-15', date: '2026-08-14' }),
        session({ id: 'today', date: TODAY }),
        session({ id: 'completed', date: '2026-08-20', status: 'completed' }),
      ],
    }))

    expect(result.signals).toContainEqual({
      kind: 'overdue-sessions',
      count: 1,
      oldestDaysAgo: 14,
    })
  })

  it('no-check-in usa createdAt normalizado a fecha local cuando nunca hubo DayLog', () => {
    const atDayTwo = computeAthleteTriage(input({
      athlete: { id: 'new-2', createdAt: new Date(2026, 7, 27, 23, 30).getTime() },
      latestDayLog: undefined,
    }))
    const atDayThree = computeAthleteTriage(input({
      athlete: { id: 'new-3', createdAt: new Date(2026, 7, 26, 23, 30).getTime() },
      latestDayLog: undefined,
    }))

    expect(atDayTwo.signals.some((signal) => signal.kind === 'no-check-in')).toBe(false)
    expect(atDayThree.signals).toContainEqual({ kind: 'no-check-in', days: 3 })
  })

  it('no-check-in reporta la antigüedad real con el último registro fuera de ventana', () => {
    const result = computeAthleteTriage(input({
      latestDayLog: dayLog({ id: 'old', date: '2026-07-20' }),
    }))

    expect(result.signals).toContainEqual({ kind: 'no-check-in', days: 40 })
  })

  it('low-adherence exige programación previa', () => {
    const result = computeAthleteTriage(input({
      previousWeekSummary: summary({ plannedSessions: 0, adherencePct: 0 }),
    }))

    expect(result.signals.some((signal) => signal.kind === 'low-adherence')).toBe(false)
    expect(result.insufficientData).toBe(true)
  })

  it('adherencia 59 dispara y 60 no', () => {
    const below = computeAthleteTriage(input({
      previousWeekSummary: summary({ plannedSessions: 4, adherencePct: 59 }),
    }))
    const edge = computeAthleteTriage(input({
      previousWeekSummary: summary({ plannedSessions: 4, adherencePct: 60 }),
    }))

    expect(below.signals).toContainEqual({ kind: 'low-adherence', adherencePct: 59 })
    expect(edge.signals.some((signal) => signal.kind === 'low-adherence')).toBe(false)
  })

  it('insufficient-data convive con no-check-in y conserva ambos', () => {
    const result = computeAthleteTriage(input({
      athlete: { id: 'new', createdAt: new Date(2026, 7, 26, 12).getTime() },
      latestDayLog: undefined,
    }))

    expect(result.insufficientData).toBe(true)
    expect(result.signals).toContainEqual({ kind: 'no-check-in', days: 3 })
  })

  it('un alumno con dolor y sin datos muestra las dos cosas', () => {
    const result = computeAthleteTriage(input({
      dayLogsInPainWindow: [dayLog({ painLevel: 4 })],
    }))

    expect(result.insufficientData).toBe(true)
    expect(result.signals).toContainEqual({ kind: 'pain', days: 1 })
  })

  it('ordena siempre dolor, vencidas, sin check-in y adherencia', () => {
    const result = computeAthleteTriage(input({
      athlete: { id: 'all', createdAt: new Date(2026, 7, 1).getTime() },
      dayLogsInPainWindow: [dayLog({ painLevel: 5 })],
      latestDayLog: dayLog({ date: '2026-08-20' }),
      sessionsInWindow: [session({ date: '2026-08-20' })],
      previousWeekSummary: summary({ plannedSessions: 3, adherencePct: 40 }),
    }))

    expect(result.signals.map((signal) => signal.kind)).toEqual([
      'pain',
      'overdue-sessions',
      'no-check-in',
      'low-adherence',
    ])
  })
})
