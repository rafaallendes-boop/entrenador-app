import { describe, expect, it } from 'vitest'
import { buildAutoAdjustmentDraft } from '../alertAdjustmentEngine'
import type { MacroWeekCoherenceSummary, Session, WeekSummary } from '../../types'
import type { LoadAnalytics } from '../loadAnalytics'

function makeSession(partial: Partial<Session> = {}): Session {
  return {
    id: partial.id ?? 'session-1',
    date: partial.date ?? '2026-04-09',
    weekStartDate: partial.weekStartDate ?? '2026-04-06',
    timeBlock: partial.timeBlock ?? 'PM',
    type: partial.type ?? 'running',
    status: partial.status ?? 'planned',
    title: partial.title ?? 'Tempo',
    durationMin: partial.durationMin ?? 50,
    rpe: partial.rpe ?? 7,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  }
}

function makeCoherence(): MacroWeekCoherenceSummary {
  return {
    currentPhase: 'peak',
    blockGoal: 'Priorizar squash',
    weeklyRule: 'squash principal, soporte minimo',
    targetDistributionBySport: { squash: 'primary', strength: 'support', running: 'excluded' },
    actualDistributionBySport: { squash: 2, strength: 2, running: 1 },
    expectedSessionsBySport: { squash: '3-4 sesiones', strength: '0-1 sesiones', running: '0 sesiones' },
    coherenceStatus: 'warning',
    coherenceIssues: ['La semana no parece consistente con la fase peak: hay demasiado trabajo accesorio.'],
  }
}

function makeSummary(partial: Partial<WeekSummary> = {}): WeekSummary {
  return {
    id: 'week-1',
    weekStartDate: '2026-04-06',
    totalSessions: 5,
    totalMinutes: 240,
    plannedSessions: 5,
    completedSessions: 2,
    plannedMinutes: 300,
    completedMinutes: 120,
    squashSessions: 1,
    runningSessions: 1,
    strengthSessions: 1,
    adherencePct: 40,
    ...partial,
  }
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
      running: { sport: 'running', acuteLoad: 600, chronicLoad: 300, ratio: 2, status: 'risk', baselineWeeks: 3 },
      strength: { sport: 'strength', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
      cycling: { sport: 'cycling', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
    },
    runningWeeklyLoads: [],
    runningAcwr: { acuteLoad: 600, chronicLoad: 300, ratio: 2, status: 'risk', baselineWeeks: 3 },
    squashWeeklyLoads: [],
    squashAcwr: { sport: 'squash', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
    strengthWeeklyLoads: [],
    strengthAcwr: { sport: 'strength', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
    cyclingWeeklyLoads: [],
    cyclingAcwr: { sport: 'cycling', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
  }
}

describe('alertAdjustmentEngine', () => {
  it('builds a coherence adjustment by reducing support load', () => {
    const draft = buildAutoAdjustmentDraft({
      sessions: [
        makeSession({ id: 'squash-1', type: 'squash', title: 'Match play', durationMin: 60 }),
        makeSession({ id: 'run-1', type: 'running', title: 'Rodaje soporte', durationMin: 55 }),
        makeSession({ id: 'strength-1', type: 'strength', title: 'Fuerza pesada', durationMin: 70 }),
      ],
      currentWeekSummary: makeSummary(),
      macroWeekCoherence: makeCoherence(),
      today: '2026-04-08',
    })

    expect(draft?.alertId).toBe('macro-week-coherence-warning')
    expect(draft?.actions.some((action) => action.type === 'update_session')).toBe(true)
  })

  it('builds a load-risk adjustment for the risky sport', () => {
    const draft = buildAutoAdjustmentDraft({
      sessions: [
        makeSession({ id: 'run-1', type: 'running', title: 'Series largas', durationMin: 70, rpe: 8 }),
      ],
      loadAnalytics: makeLoadAnalytics(),
      today: '2026-04-08',
    })

    expect(draft?.alertId).toBe('acwr-risk-running')
    expect(draft?.actions[0]).toMatchObject({
      type: 'update_session',
      sessionId: 'run-1',
      newRpe: 6,
    })
  })

  it('uses mobility support instead of generic recovery for cycling load risk', () => {
    const draft = buildAutoAdjustmentDraft({
      sessions: [
        makeSession({ id: 'cycle-1', type: 'cycling', title: 'Ciclismo intervalos', durationMin: 70, rpe: 8 }),
      ],
      loadAnalytics: {
        ...makeLoadAnalytics(),
        acwrByDiscipline: {
          squash: { sport: 'squash', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
          running: { sport: 'running', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
          strength: { sport: 'strength', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
          cycling: { sport: 'cycling', acuteLoad: 600, chronicLoad: 300, ratio: 2, status: 'risk', baselineWeeks: 3 },
        },
        runningAcwr: { acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
        cyclingAcwr: { sport: 'cycling', acuteLoad: 600, chronicLoad: 300, ratio: 2, status: 'risk', baselineWeeks: 3 },
      },
      today: '2026-04-08',
    })

    expect(draft?.alertId).toBe('acwr-risk-cycling')
    expect(draft?.actions[0]).toMatchObject({
      type: 'update_session',
      sessionId: 'cycle-1',
    })
    expect(draft?.actions.some((action) => action.type === 'add_session' && action.sessionType === 'mobility')).toBe(true)
  })

  it('falls back to adherence adjustment when there is no higher-severity draft', () => {
    const draft = buildAutoAdjustmentDraft({
      sessions: [
        makeSession({ id: 'run-1', type: 'running', title: 'Tempo', date: '2026-04-10' }),
        makeSession({ id: 'strength-1', type: 'strength', title: 'Fuerza', date: '2026-04-11' }),
      ],
      currentWeekSummary: makeSummary({ adherencePct: 40 }),
      today: '2026-04-09',
    })

    expect(draft?.alertId).toBe('weekly-adherence-drop')
    expect(draft?.actions.some((action) => action.type === 'update_session')).toBe(true)
  })
})
