import { describe, expect, it } from 'vitest'

import type { DayLog, MacroWeekCoherenceSummary, Session, WeekSummary } from '../../types'
import { buildWeeklyActionSummary } from '../weeklyActionLoop'

function makeSession(partial: Partial<Session> = {}): Session {
  return {
    id: partial.id ?? 'session-1',
    date: partial.date ?? '2026-04-08',
    timeBlock: partial.timeBlock ?? 'AM',
    type: partial.type ?? 'running',
    status: partial.status ?? 'planned',
    title: partial.title ?? 'Running Z2',
    durationMin: partial.durationMin ?? 45,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  }
}

function makeSummary(partial: Partial<WeekSummary> = {}): WeekSummary {
  return {
    id: 'week-1',
    weekStartDate: '2026-04-06',
    totalSessions: 4,
    totalMinutes: 240,
    plannedSessions: 4,
    completedSessions: 3,
    plannedMinutes: 240,
    completedMinutes: 180,
    adherencePct: 75,
    squashSessions: 0,
    runningSessions: 2,
    strengthSessions: 1,
    ...partial,
  }
}

function makeCoherenceSummary(partial: Partial<MacroWeekCoherenceSummary> = {}): MacroWeekCoherenceSummary {
  return {
    currentPhase: 'build',
    blockGoal: 'Subir especificidad de running',
    weeklyRule: 'running: calidad controlada',
    targetDistributionBySport: { running: 'primary' },
    actualDistributionBySport: { running: 1 },
    expectedSessionsBySport: { running: '3-5 sesiones' },
    coherenceStatus: 'warning',
    coherenceIssues: ['La semana no parece consistente con la fase build.'],
    ...partial,
  }
}

describe('buildWeeklyActionSummary', () => {
  it('prioritizes plan_week for an empty week between monday and wednesday', () => {
    const summary = buildWeeklyActionSummary({
      sessions: [],
      currentWeekSummary: makeSummary({ totalSessions: 0, plannedSessions: 0, completedSessions: 0 }),
      today: '2026-04-08',
    })

    expect(summary.primaryAction?.kind).toBe('plan_week')
    expect(summary.primaryAction?.ctaTarget).toBe('plan_builder')
    expect(summary.weekState).toBe('empty')
  })

  it('does not mark the week as empty when plannedSessions exist but totalSessions is stale', () => {
    const summary = buildWeeklyActionSummary({
      sessions: [makeSession(), makeSession({ id: 'session-2', date: '2026-04-09' })],
      currentWeekSummary: makeSummary({
        totalSessions: 0,
        plannedSessions: 2,
        completedSessions: 0,
        coachNote: undefined,
      }),
      today: '2026-04-08',
    })

    expect(summary.primaryAction?.kind).not.toBe('plan_week')
    expect(summary.weekState).not.toBe('empty')
  })

  it('prioritizes coherence fixes before coach note review', () => {
    const summary = buildWeeklyActionSummary({
      sessions: [makeSession()],
      currentWeekSummary: makeSummary({ coachNote: undefined }),
      macroWeekCoherence: makeCoherenceSummary(),
      today: '2026-04-08',
    })

    expect(summary.primaryAction?.kind).toBe('fix_coherence')
    expect(summary.secondaryActions.some((action) => action.kind === 'review_coach_note')).toBe(true)
  })

  it('creates a close_checkin action when completed sessions or day context are missing closure', () => {
    const summary = buildWeeklyActionSummary({
      sessions: [makeSession({ status: 'completed' })],
      currentWeekSummary: makeSummary(),
      today: '2026-04-08',
    })

    expect(summary.primaryAction?.kind).toBe('close_checkin')
    expect(summary.checkInStatus).toBe('pending')
  })

  it('creates recover_adherence when the week is slipping', () => {
    const summary = buildWeeklyActionSummary({
      sessions: [makeSession({ status: 'completed' })],
      currentWeekSummary: makeSummary({
        totalSessions: 5,
        plannedSessions: 5,
        completedSessions: 2,
        adherencePct: 40,
      }),
      today: '2026-04-10',
    })

    expect(summary.primaryAction?.kind).toBe('recover_adherence')
    expect(summary.adherenceStatus).toBe('at_risk')
  })

  it('reports on_track when the week has plan, no warnings and check-in is closed', () => {
    const todayDayLog: DayLog = {
      id: 'day-1',
      date: '2026-04-08',
      energyLevel: 7,
      sleepQuality: 4,
      rpeActual: 6,
      updatedAt: 1,
    }

    const summary = buildWeeklyActionSummary({
      sessions: [
        makeSession({
          status: 'completed',
          sessionFeedback: {
            rating: 4,
            energyDuringSession: 4,
            capturedAt: 1,
          },
        }),
      ],
      currentWeekSummary: makeSummary({ coachNote: 'Semana bien distribuida.' }),
      macroWeekCoherence: makeCoherenceSummary({ coherenceStatus: 'ok', coherenceIssues: [] }),
      todayDayLog,
      today: '2026-04-08',
    })

    expect(summary.primaryAction).toBeNull()
    expect(summary.weekState).toBe('on_track')
    expect(summary.checkInStatus).toBe('complete')
    expect(summary.coherenceStatus).toBe('ok')
  })
})
