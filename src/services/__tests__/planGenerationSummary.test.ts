import { describe, expect, it } from 'vitest'

import type { AthleteProfile, CoachAction, Session } from '../../types'
import { buildPlanGenerationSummary, validateGeneratedPlan } from '../planGenerationSummary'

function makeProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    id: 'default',
    updatedAt: 1,
    primarySport: 'running',
    secondarySports: ['squash', 'strength'],
    sportContext: {
      enabledSports: ['running', 'squash', 'strength'],
      primarySport: 'running',
      secondarySports: ['squash', 'strength'],
      trainingPriority: 'performance',
    },
    goalEvents: [
      {
        id: 'goal-squash',
        title: '2do nacional',
        date: '2026-05-10',
        sport: 'squash',
        priority: 'primary',
        eventType: 'tournament',
      },
    ],
    planWizardConfig: {
      goalEventId: 'goal-squash',
      trainingDays: ['monday', 'wednesday', 'friday'],
      sessionsPerWeek: 4,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: ['strength'],
      currentFitnessLevel: 'normal',
      currentFatigue: 'normal',
      createdAt: '2026-04-01',
      updatedAt: '2026-04-01',
    },
    ...overrides,
  }
}

function makeHistoricalSession(overrides: Partial<Session> & { type: Session['type']; date: string }): Session {
  const { type, date, ...rest } = overrides
  return {
    id: `${type}-${date}`,
    date,
    timeBlock: 'AM',
    type,
    status: 'completed',
    title: 'Historical session',
    durationMin: 60,
    rpe: 6,
    createdAt: 1,
    updatedAt: 1,
    ...rest,
  } as Session
}

function createWeekAction(sessions: NonNullable<CoachAction['sessions']>, weekObjectives: string[] = ['Build squash volume while maintaining strength']): CoachAction {
  return {
    type: 'create_week',
    reason: 'semana propuesta',
    sessions,
    weekObjectives,
  }
}

describe('planGenerationSummary', () => {
  const historicalSessions: Session[] = [
    makeHistoricalSession({ type: 'squash', date: '2026-04-01' }),
    makeHistoricalSession({
      type: 'strength',
      date: '2026-03-30',
      exercises: [{ id: 'sq', name: 'Back squat', sets: 4, reps: 5, completed: false }],
    }),
    makeHistoricalSession({
      type: 'running',
      date: '2026-03-28',
      runningDetails: { runningType: 'z2', targetPaceMin: '5:20', targetPaceMax: '5:40' },
    }),
  ]

  it('builds a correct summary for squash + strength and excludes running', () => {
    const summary = buildPlanGenerationSummary({
      athleteProfile: makeProfile(),
      actions: [
        createWeekAction([
          { date: '2026-04-13', timeBlock: 'AM', sessionType: 'squash', title: 'Squash tecnico', durationMin: 75, rpe: 7 },
          { date: '2026-04-15', timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza base', durationMin: 60, rpe: 6 },
        ]),
      ],
      historicalSessions,
    })

    expect(summary).toBeDefined()
    expect(summary?.allowedSports).toEqual(['squash', 'strength'])
    expect(summary?.excludedSports).toContain('running')
    expect(summary?.sessionsBySport.squash).toBe(1)
    expect(summary?.sessionsBySport.strength).toBe(1)
    expect(summary?.sessionsBySport.running).toBe(0)
    expect(summary?.weeklyGoalSummary).toContain('Build squash volume while maintaining strength')
    expect(summary?.macroWeekCoherence.currentPhase).toBeDefined()
    expect(summary?.macroWeekCoherence.targetDistributionBySport.squash).toBe('primary')
    expect(summary?.macroWeekCoherence.actualDistributionBySport.running).toBe(0)
  })

  it('does not include strength or running for a squash-only plan', () => {
    const profile = makeProfile({
      primarySport: 'squash',
      secondarySports: [],
      sportContext: {
        enabledSports: ['squash'],
        primarySport: 'squash',
        secondarySports: [],
        trainingPriority: 'performance',
      },
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        complementarySports: [],
      },
    })

    const summary = buildPlanGenerationSummary({
      athleteProfile: profile,
      actions: [
        createWeekAction([
          { date: '2026-04-13', timeBlock: 'AM', sessionType: 'squash', title: 'Match prep', durationMin: 60, rpe: 6 },
        ], ['Hold squash quality']),
      ],
      historicalSessions,
    })

    expect(summary?.allowedSports).toEqual(['squash'])
    expect(summary?.excludedSports).toEqual(expect.arrayContaining(['running', 'strength']))
    expect(summary?.sessionsBySport.squash).toBe(1)
    expect(summary?.sessionsBySport.running).toBe(0)
    expect(summary?.sessionsBySport.strength).toBe(0)
  })

  it('allows running when the plan explicitly includes it', () => {
    const profile = makeProfile({
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        complementarySports: ['running'],
      },
    })

    const summary = buildPlanGenerationSummary({
      athleteProfile: profile,
      actions: [
        createWeekAction([
          { date: '2026-04-13', timeBlock: 'AM', sessionType: 'squash', title: 'Squash tecnico', durationMin: 70, rpe: 7 },
          { date: '2026-04-14', timeBlock: 'AM', sessionType: 'running', title: 'Running Z2', durationMin: 45, rpe: 6 },
        ], ['Progress squash with support running']),
      ],
      historicalSessions,
    })

    expect(summary?.allowedSports).toEqual(['squash', 'running'])
    expect(summary?.excludedSports).toContain('strength')
    expect(summary?.sessionsBySport.running).toBe(1)
  })

  it('flags a validation warning when a disallowed sport appears', () => {
    const profile = makeProfile({
      primarySport: 'squash',
      secondarySports: [],
      sportContext: {
        enabledSports: ['squash'],
        primarySport: 'squash',
        secondarySports: [],
        trainingPriority: 'performance',
      },
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        complementarySports: [],
      },
    })

    const result = validateGeneratedPlan({
      athleteProfile: profile,
      sessions: [
        { date: '2026-04-13', timeBlock: 'AM', sessionType: 'squash', title: 'Squash tecnico', durationMin: 60 },
        { date: '2026-04-14', timeBlock: 'AM', sessionType: 'running', title: 'Running tempo', durationMin: 45 },
      ],
      intentsBySport: { squash: 'progress' },
    })

    expect(result.validationStatus).toBe('warning')
    expect(result.validationIssues).toEqual(
      expect.arrayContaining([expect.stringContaining('deporte no permitido')]),
    )
  })

  it('calculates sessionsBySport and excludedSports correctly', () => {
    const summary = buildPlanGenerationSummary({
      athleteProfile: makeProfile(),
      actions: [
        createWeekAction([
          { date: '2026-04-13', timeBlock: 'AM', sessionType: 'squash', title: 'Squash 1', durationMin: 60 },
          { date: '2026-04-14', timeBlock: 'PM', sessionType: 'squash', title: 'Squash 2', durationMin: 60 },
          { date: '2026-04-15', timeBlock: 'PM', sessionType: 'strength', title: 'Strength', durationMin: 50 },
        ]),
      ],
      historicalSessions,
    })

    expect(summary?.sessionsBySport).toMatchObject({
      squash: 2,
      strength: 1,
      running: 0,
    })
    expect(summary?.excludedSports).toEqual(expect.arrayContaining(['running', 'cycling']))
  })

  it('reflects weeklyIntent and weeklyGoalSummary in the summary', () => {
    const summary = buildPlanGenerationSummary({
      athleteProfile: makeProfile(),
      actions: [
        createWeekAction([
          { date: '2026-04-13', timeBlock: 'AM', sessionType: 'squash', title: 'Squash tecnico', durationMin: 75, rpe: 7 },
          { date: '2026-04-15', timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza base', durationMin: 60, rpe: 6 },
        ], ['Build squash volume while maintaining strength']),
      ],
      historicalSessions,
    })

    expect(summary?.weeklyIntent).toBeDefined()
    expect(summary?.weeklyGoalSummary).toBe('Build squash volume while maintaining strength')
    expect(summary?.macroWeekCoherence.weeklyRule.length).toBeGreaterThan(0)
  })
})
