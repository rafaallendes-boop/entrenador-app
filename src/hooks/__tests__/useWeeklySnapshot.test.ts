import { describe, expect, it } from 'vitest'

import type { MacroWeekCoherenceSummary, Session, WeekSummary } from '../../types'
import type { LoadAnalytics } from '../../services/loadAnalytics'
import { buildWeeklySnapshot } from '../useWeeklySnapshot'
import { buildWeeklyActionSummary } from '../../services/weeklyActionLoop'
import { buildAutoAdjustmentDraft } from '../../services/alertAdjustmentEngine'

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

function makeCoherence(partial: Partial<MacroWeekCoherenceSummary> = {}): MacroWeekCoherenceSummary {
  return {
    currentPhase: 'peak',
    blockGoal: 'Priorizar squash',
    weeklyRule: 'squash principal, soporte minimo',
    targetDistributionBySport: { squash: 'primary', strength: 'support', running: 'excluded' },
    actualDistributionBySport: { squash: 2, strength: 2, running: 1 },
    expectedSessionsBySport: { squash: '3-4 sesiones', strength: '0-1 sesiones', running: '0 sesiones' },
    coherenceStatus: 'warning',
    coherenceIssues: ['La semana no parece consistente con la fase peak: hay demasiado trabajo accesorio.'],
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

describe('buildWeeklySnapshot', () => {
  it('matches the direct weekly action summary when analytics are missing', () => {
    const input = {
      sessions: [],
      currentWeekSummary: makeSummary({ totalSessions: 0, plannedSessions: 0, completedSessions: 0 }),
      today: '2026-04-08',
    }

    const snapshot = buildWeeklySnapshot(input)
    const directSummary = buildWeeklyActionSummary(input)

    expect(snapshot.loadAnalytics).toBeNull()
    expect(snapshot.weeklyActionSummary).toEqual(directSummary)
    expect(snapshot.autoAdjustmentDraft).toBeNull()
  })

  it('keeps coherence and auto-adjustment decisions aligned when analytics exist', () => {
    const input = {
      sessions: [
        makeSession({ id: 'run-1', type: 'running', title: 'Rodaje soporte', durationMin: 55 }),
        makeSession({ id: 'strength-1', type: 'strength', title: 'Fuerza pesada', durationMin: 70 }),
      ],
      currentWeekSummary: makeSummary(),
      macroWeekCoherence: makeCoherence(),
      loadAnalytics: makeLoadAnalytics(),
      today: '2026-04-08',
    }

    const snapshot = buildWeeklySnapshot(input)
    const directSummary = buildWeeklyActionSummary(input)
    const directDraft = buildAutoAdjustmentDraft(input)

    expect(snapshot.weeklyActionSummary).toEqual(directSummary)
    expect(snapshot.autoAdjustmentDraft).toEqual(directDraft)
    expect(snapshot.autoAdjustmentDraft?.alertId).toBeTruthy()
  })
})
