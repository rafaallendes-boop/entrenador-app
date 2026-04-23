import { describe, expect, it } from 'vitest'

import type { ChatContext, CoachAction, CoachSessionProposal } from '../../types'
import type { CoachNormalizedResponse } from '../ai/types'
import { validateWeekPlanningResponse } from '../weekPlanning/validateWeekPlanningResponse'

function makeContext(): ChatContext {
  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteProfile: {
      id: 'athlete-1',
      updatedAt: Date.now(),
      sportContext: {
        enabledSports: ['squash', 'running', 'strength'],
        primarySport: 'squash',
      },
      goalEvents: [
        {
          id: 'goal-1',
          title: 'Regional',
          date: '2026-05-30',
          sport: 'squash',
          priority: 'primary',
        },
      ],
      planWizardConfig: {
        goalEventId: 'goal-1',
        trainingDays: ['monday', 'tuesday', 'thursday', 'saturday'],
        sessionsPerWeek: 4,
        sessionDurationMins: 60,
        allowDoubleSession: false,
        complementarySports: ['running', 'strength'],
        currentFitnessLevel: 'normal',
        currentFatigue: 'fresh',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
    intent: 'plan_week',
  }
}

function makeSessions(): CoachSessionProposal[] {
  return [
    {
      date: '2026-05-04',
      timeBlock: 'AM',
      sessionType: 'squash',
      title: 'Squash técnico',
      durationMin: 60,
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        sessionKind: 'technical',
        drills: [{ name: 'Drive', durationMin: 12 }],
      },
    },
    {
      date: '2026-05-05',
      timeBlock: 'AM',
      sessionType: 'strength',
      title: 'Fuerza base',
      durationMin: 55,
      exercises: [{ name: 'Squat', sets: 4, reps: 5, group: 'legs' }],
    },
    {
      date: '2026-05-07',
      timeBlock: 'PM',
      sessionType: 'running',
      title: 'Tempo',
      durationMin: 45,
      runningType: 'tempo',
    },
    {
      date: '2026-05-09',
      timeBlock: 'AM',
      sessionType: 'squash',
      title: 'Match play',
      durationMin: 60,
      squashDetails: {
        trainingFocus: 'tactical',
        sessionMode: 'practice_match',
        sessionKind: 'match',
        drills: [{ name: 'Game plan', durationMin: 15 }],
      },
    },
  ]
}

function makeResponse(actions: CoachAction[]): CoachNormalizedResponse {
  return {
    message: '',
    actions,
    provider: 'mock',
    timestamp: Date.now(),
    traceId: 'test-trace',
    requestClass: 'plan_builder_week',
    meta: {
      hadActionsMarkup: true,
      actionParseFailed: false,
      likelyTruncated: false,
    },
  }
}

describe('validateWeekPlanningResponse', () => {
  it('accepts a valid single create_week for the target monday', () => {
    const result = validateWeekPlanningResponse({
      response: makeResponse([
        {
          type: 'create_week',
          reason: 'semana sólida',
          targetDate: '2026-05-04',
          sessions: makeSessions(),
        },
      ]),
      context: makeContext(),
      targetWeekStart: '2026-05-04',
    })

    expect(result.ok).toBe(true)
  })

  it('rejects incorrect targetDate values', () => {
    const result = validateWeekPlanningResponse({
      response: makeResponse([
        {
          type: 'create_week',
          reason: 'semana corrida',
          targetDate: '2026-05-11',
          sessions: makeSessions(),
        },
      ]),
      context: makeContext(),
      targetWeekStart: '2026-05-04',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('targetDate=2026-05-04')
  })

  it('rejects weeks with the wrong number of sessions', () => {
    const result = validateWeekPlanningResponse({
      response: makeResponse([
        {
          type: 'create_week',
          reason: 'incompleta',
          targetDate: '2026-05-04',
          sessions: makeSessions().slice(0, 3),
        },
      ]),
      context: makeContext(),
      targetWeekStart: '2026-05-04',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('exactamente 4 sesiones')
  })

  it('rejects sessions outside the target week', () => {
    const sessions = makeSessions()
    sessions[3] = {
      ...sessions[3],
      date: '2026-05-11',
    }

    const result = validateWeekPlanningResponse({
      response: makeResponse([
        {
          type: 'create_week',
          reason: 'fuera de rango',
          targetDate: '2026-05-04',
          sessions,
        },
      ]),
      context: makeContext(),
      targetWeekStart: '2026-05-04',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('deben caer entre 2026-05-04')
  })
})
