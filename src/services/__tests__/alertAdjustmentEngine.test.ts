import { describe, expect, it } from 'vitest'
import { buildAutoAdjustmentDraft } from '../alertAdjustmentEngine'
import type { AthleteProfile, MacroWeekCoherenceSummary, Session, WeekSummary } from '../../types'
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

function makeCoherence(overrides: Partial<MacroWeekCoherenceSummary> = {}): MacroWeekCoherenceSummary {
  return {
    currentPhase: 'peak',
    blockGoal: 'Priorizar squash',
    weeklyRule: 'squash principal, soporte minimo',
    targetDistributionBySport: { squash: 'primary', strength: 'support', running: 'excluded' },
    actualDistributionBySport: { squash: 2, strength: 2, running: 1 },
    expectedSessionsBySport: { squash: '3-4 sesiones', strength: '0-1 sesiones', running: '0 sesiones' },
    coherenceStatus: 'warning',
    coherenceIssues: ['La semana no parece consistente con la fase peak: hay demasiado trabajo accesorio.'],
    ...overrides,
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

function makeLoadAnalytics(runningStatus: LoadAnalytics['acwrByDiscipline']['running']['status'] = 'risk'): LoadAnalytics {
  return {
    weeks: [],
    overallTrend: 'stable',
    runningTrend: 'stable',
    adherenceTrend: 'stable',
    acwr: null,
    acwrByDiscipline: {
      squash: { sport: 'squash', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
      running: { sport: 'running', acuteLoad: 600, chronicLoad: 300, ratio: runningStatus === 'risk' ? 2 : 0.7, status: runningStatus, baselineWeeks: 3 },
      strength: { sport: 'strength', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
      cycling: { sport: 'cycling', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
    },
    runningWeeklyLoads: [],
    runningAcwr: runningStatus === 'risk'
      ? { acuteLoad: 600, chronicLoad: 300, ratio: 2, status: 'risk', baselineWeeks: 3 }
      : { acuteLoad: 250, chronicLoad: 400, ratio: 0.63, status: 'undertrained', baselineWeeks: 3 },
    squashWeeklyLoads: [],
    squashAcwr: { sport: 'squash', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
    strengthWeeklyLoads: [],
    strengthAcwr: { sport: 'strength', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
    cyclingWeeklyLoads: [],
    cyclingAcwr: { sport: 'cycling', acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
  }
}

function makeProfile(): AthleteProfile {
  return {
    id: 'default',
    updatedAt: 1,
    primarySport: 'running',
    sportContext: {
      enabledSports: ['running', 'strength', 'squash'],
      primarySport: 'running',
      secondarySports: ['strength', 'squash'],
      trainingPriority: 'performance',
    },
  }
}

describe('alertAdjustmentEngine', () => {
  it('prioritizes acwr risk over coherence when both are present', () => {
    const draft = buildAutoAdjustmentDraft({
      sessions: [
        makeSession({ id: 'run-1', type: 'running', title: 'Series largas', durationMin: 70, rpe: 8 }),
        makeSession({ id: 'strength-1', type: 'strength', title: 'Fuerza pesada', durationMin: 70 }),
      ],
      currentWeekSummary: makeSummary(),
      macroWeekCoherence: makeCoherence(),
      loadAnalytics: makeLoadAnalytics('risk'),
      today: '2026-04-08',
    })

    expect(draft?.alertId).toBe('acwr-risk-running')
    expect(draft?.actions[0]).toMatchObject({
      type: 'update_session',
      sessionId: 'run-1',
    })
  })

  it('builds a coherence adjustment by reducing support load and uses slot adherence to choose the target', () => {
    const historicalSessions = [
      makeSession({ id: 'hist-1', date: '2026-03-09', timeBlock: 'AM', status: 'completed', type: 'strength', durationMin: 60 }),
      makeSession({ id: 'hist-2', date: '2026-03-16', timeBlock: 'AM', status: 'planned', type: 'strength', durationMin: 60 }),
      makeSession({ id: 'hist-3', date: '2026-03-23', timeBlock: 'AM', status: 'planned', type: 'strength', durationMin: 60 }),
      makeSession({ id: 'hist-4', date: '2026-03-30', timeBlock: 'AM', status: 'planned', type: 'strength', durationMin: 60 }),
      makeSession({ id: 'hist-5', date: '2026-03-13', timeBlock: 'AM', status: 'completed', type: 'strength', durationMin: 60 }),
      makeSession({ id: 'hist-6', date: '2026-03-20', timeBlock: 'AM', status: 'completed', type: 'strength', durationMin: 60 }),
      makeSession({ id: 'hist-7', date: '2026-03-27', timeBlock: 'AM', status: 'completed', type: 'strength', durationMin: 60 }),
      makeSession({ id: 'hist-8', date: '2026-04-03', timeBlock: 'AM', status: 'completed', type: 'strength', durationMin: 60 }),
    ]

    const draft = buildAutoAdjustmentDraft({
      sessions: [
        makeSession({ id: 'support-bad', date: '2026-04-09', timeBlock: 'AM', type: 'strength', title: 'Soporte lunes', durationMin: 60 }),
        makeSession({ id: 'support-good', date: '2026-04-11', timeBlock: 'AM', type: 'strength', title: 'Soporte viernes', durationMin: 60 }),
        makeSession({ id: 'squash-1', date: '2026-04-10', timeBlock: 'PM', type: 'squash', title: 'Match play', durationMin: 70 }),
      ],
      currentWeekSummary: makeSummary(),
      macroWeekCoherence: makeCoherence({
        targetDistributionBySport: { squash: 'primary', strength: 'support', running: 'excluded' },
      }),
      historicalSessions,
      athleteProfile: makeProfile(),
      today: '2026-04-08',
    })

    expect(draft?.alertId).toBe('macro-week-coherence-warning')
    expect(draft?.actions[0]).toMatchObject({
      type: 'move_session',
      sessionId: 'support-bad',
    })
    expect(draft?.actions.length).toBeLessThanOrEqual(3)
  })

  it('builds a load-risk adjustment for the risky sport', () => {
    const draft = buildAutoAdjustmentDraft({
      sessions: [
        makeSession({ id: 'run-1', type: 'running', title: 'Series largas', durationMin: 70, rpe: 8 }),
      ],
      loadAnalytics: makeLoadAnalytics('risk'),
      today: '2026-04-08',
    })

    expect(draft?.alertId).toBe('acwr-risk-running')
    expect(draft?.actions[0]).toMatchObject({
      type: 'update_session',
      sessionId: 'run-1',
      newRpe: 6,
    })
  })

  it('covers recovery and check-in alerts with a real adjustment draft', () => {
    const draft = buildAutoAdjustmentDraft({
      sessions: [
        makeSession({ id: 'today-1', date: '2026-04-08', type: 'running', status: 'completed', title: 'Rodaje', durationMin: 45 }),
        makeSession({ id: 'tomorrow-1', date: '2026-04-09', type: 'strength', title: 'Fuerza', durationMin: 70, rpe: 7 }),
      ],
      currentWeekSummary: makeSummary(),
      todayDayLog: undefined,
      today: '2026-04-08',
    })

    expect(draft?.alertId).toBe('recovery-checkin-missing')
    expect(draft?.actions.some((action) => action.type === 'update_session')).toBe(true)
    expect(draft?.actions.length).toBeGreaterThanOrEqual(1)
    expect(draft?.actions.length).toBeLessThanOrEqual(3)
  })

  it('adds a light support session when the load is undertrained and there is no higher-severity alert', () => {
    const draft = buildAutoAdjustmentDraft({
      sessions: [
        makeSession({ id: 'run-1', date: '2026-04-09', type: 'running', title: 'Rodaje base', durationMin: 45, rpe: 4 }),
        makeSession({ id: 'strength-1', date: '2026-04-10', type: 'strength', title: 'Fuerza base', durationMin: 40, rpe: 4 }),
      ],
      loadAnalytics: makeLoadAnalytics('undertrained'),
      athleteProfile: makeProfile(),
      today: '2026-04-08',
    })

    expect(draft?.alertId).toBe('acwr-undertrained-running')
    expect(draft?.actions).toHaveLength(1)
    expect(draft?.actions[0]).toMatchObject({
      type: 'update_session',
      sessionId: 'run-1',
    })
  })

  it('uses mobility support instead of generic recovery for cycling load risk', () => {
    const draft = buildAutoAdjustmentDraft({
      sessions: [
        makeSession({ id: 'cycle-1', type: 'cycling', title: 'Ciclismo intervalos', durationMin: 70, rpe: 8 }),
      ],
      loadAnalytics: {
        ...makeLoadAnalytics('risk'),
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
