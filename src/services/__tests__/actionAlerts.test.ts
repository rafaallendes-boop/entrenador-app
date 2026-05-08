import { addDays, subWeeks } from 'date-fns'
import { describe, expect, it } from 'vitest'

import type { MacroWeekCoherenceSummary, Session, WeekSummary } from '../../types'
import { toISO, getWeekStart } from '../../utils/date'
import type { LoadAnalytics } from '../loadAnalytics'
import { buildActionAlerts } from '../actionAlerts'

function dateInWeek(weeksAgo: number, dayOffset = 0): string {
  const monday = getWeekStart(subWeeks(new Date(), weeksAgo))
  return toISO(addDays(monday, dayOffset))
}

let idSeq = 0
function makeSession(overrides: Partial<Session> & { type: Session['type'] }): Session {
  idSeq += 1
  return {
    id: `session-${idSeq}`,
    date: dateInWeek(0),
    timeBlock: 'AM',
    status: 'completed',
    title: 'Test session',
    durationMin: 60,
    rpe: 6,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Session
}

function makeLoadAnalytics(): LoadAnalytics {
  return {
    weeks: [],
    overallTrend: 'stable',
    runningTrend: 'stable',
    adherenceTrend: 'stable',
    acwr: null,
    acwrByDiscipline: {
      squash: { sport: 'squash', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
      running: { sport: 'running', acuteLoad: 960, chronicLoad: 600, ratio: 1.6, status: 'risk', baselineWeeks: 3 },
      strength: { sport: 'strength', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
      cycling: { sport: 'cycling', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
    },
    runningWeeklyLoads: [],
    runningAcwr: { acuteLoad: 960, chronicLoad: 600, ratio: 1.6, status: 'risk', baselineWeeks: 3 },
    squashWeeklyLoads: [],
    squashAcwr: { sport: 'squash', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
    strengthWeeklyLoads: [],
    strengthAcwr: { sport: 'strength', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
    cyclingWeeklyLoads: [],
    cyclingAcwr: { sport: 'cycling', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
  }
}

function makeCoherenceSummary(): MacroWeekCoherenceSummary {
  return {
    currentPhase: 'peak',
    blockGoal: 'Sharpen squash quality',
    weeklyRule: 'Priorizar calidad especifica y recortar accesorio innecesario.',
    targetDistributionBySport: { squash: 'primary', running: 'support', strength: 'support', mobility: 'support', cycling: 'excluded' },
    actualDistributionBySport: { squash: 1, running: 3, strength: 2 },
    expectedSessionsBySport: { squash: '3-4 sesiones', running: '0 sesiones o Z2 muy corta' },
    coherenceStatus: 'warning',
    coherenceIssues: ['La semana no parece consistente con la fase peak: hay demasiado trabajo accesorio.'],
  }
}

describe('buildActionAlerts', () => {
  it('prioritizes macro-week coherence before lower-priority alerts', () => {
    const alerts = buildActionAlerts({
      sessions: [
        makeSession({ type: 'running', date: dateInWeek(0), status: 'completed' }),
      ],
      loadAnalytics: makeLoadAnalytics(),
      macroWeekCoherence: makeCoherenceSummary(),
      today: dateInWeek(0),
    })

    expect(alerts[0]?.id).toBe('macro-week-coherence-warning')
    expect(alerts[0]?.severity).toBe('high')
    expect(alerts[0]?.target).toBe('week')
  })

  it('creates a chat-directed high-priority alert when ACWR is at risk', () => {
    const alerts = buildActionAlerts({
      sessions: [],
      loadAnalytics: makeLoadAnalytics(),
      today: dateInWeek(0),
    })

    expect(alerts[0]?.id).toBe('acwr-risk-running')
    expect(alerts[0]?.target).toBe('chat')
    expect(alerts[0]?.title).toContain('running')
  })

  it('renders a valid label when mobility appears in ACWR by discipline', () => {
    const alerts = buildActionAlerts({
      sessions: [],
      loadAnalytics: {
        ...makeLoadAnalytics(),
        acwrByDiscipline: {
          squash: { sport: 'squash', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
          running: { sport: 'running', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
          strength: { sport: 'strength', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
          cycling: { sport: 'cycling', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
          mobility: { sport: 'mobility', acuteLoad: 180, chronicLoad: 90, ratio: 2, status: 'risk', baselineWeeks: 3 },
        },
      } as LoadAnalytics,
      today: dateInWeek(0),
    })

    expect(alerts[0]?.id).toBe('acwr-risk-mobility')
    expect(alerts[0]?.title).toContain('movilidad')
  })

  it('creates a check-in alert when completed sessions still lack feedback or daily context', () => {
    const alerts = buildActionAlerts({
      sessions: [
        makeSession({ type: 'running', date: dateInWeek(0), status: 'completed' }),
      ],
      today: dateInWeek(0),
    })

    expect(alerts[0]?.target).toBe('checkin')
    expect(alerts[0]?.id).toBe('recovery-checkin-missing')
  })

  it('creates an adherence alert when the week is clearly slipping', () => {
    const summary: WeekSummary = {
      id: 'week-1',
      weekStartDate: dateInWeek(0),
      totalSessions: 5,
      totalMinutes: 300,
      plannedSessions: 5,
      completedSessions: 2,
      plannedMinutes: 300,
      completedMinutes: 120,
      adherencePct: 40,
      squashSessions: 1,
      runningSessions: 1,
      strengthSessions: 0,
    }

    const alerts = buildActionAlerts({
      sessions: [],
      currentWeekSummary: summary,
      today: dateInWeek(0),
    })

    expect(alerts[0]?.id).toBe('weekly-adherence-drop')
    expect(alerts[0]?.target).toBe('chat')
  })

  it('does not create an adherence alert when all uncompleted sessions are still upcoming', () => {
    const summary: WeekSummary = {
      id: 'week-1',
      weekStartDate: '2026-05-04',
      totalSessions: 5,
      totalMinutes: 300,
      plannedSessions: 5,
      completedSessions: 0,
      plannedMinutes: 300,
      completedMinutes: 0,
      adherencePct: 0,
      squashSessions: 3,
      runningSessions: 1,
      strengthSessions: 1,
    }

    const alerts = buildActionAlerts({
      sessions: [
        makeSession({ type: 'squash', date: '2026-05-08', status: 'planned' }),
        makeSession({ type: 'running', date: '2026-05-09', status: 'planned' }),
      ],
      currentWeekSummary: summary,
      today: '2026-05-08',
    })

    expect(alerts.some((alert) => alert.id === 'weekly-adherence-drop')).toBe(false)
  })
})
