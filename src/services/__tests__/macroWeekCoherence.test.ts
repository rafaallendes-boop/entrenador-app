import { describe, expect, it } from 'vitest'

import type { AthleteProfile, CoachSessionProposal, Session, SupportedSport } from '../../types'
import { buildMacroWeekCoherenceSummary } from '../macroWeekCoherence'

function makeProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    id: 'default',
    updatedAt: 1,
    primarySport: 'squash',
    sportContext: {
      enabledSports: ['squash', 'strength'],
      primarySport: 'squash',
      secondarySports: ['strength'],
      trainingPriority: 'performance',
    },
    goalEvents: [
      {
        id: 'goal-1',
        title: 'Nacional squash',
        date: '2026-06-15',
        sport: 'squash',
        priority: 'primary',
        eventType: 'tournament',
      },
    ],
    planWizardConfig: {
      goalEventId: 'goal-1',
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

function makeSession(sessionType: SupportedSport, durationMin = 60, rpe = 6): CoachSessionProposal {
  return {
    date: '2026-04-13',
    timeBlock: 'AM',
    sessionType,
    title: `${sessionType} session`,
    durationMin,
    rpe,
  }
}

function makeHistoricalSession(type: Session['type'], date: string, durationMin = 60, rpe = 6): Session {
  return {
    id: `${type}-${date}`,
    date,
    timeBlock: 'AM',
    type,
    status: 'completed',
    title: `${type} historical`,
    durationMin,
    rpe,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('macroWeekCoherence', () => {
  const referenceDate = new Date('2026-04-07T00:00:00')
  const historicalSessions = [
    makeHistoricalSession('squash', '2026-04-01', 75, 7),
    makeHistoricalSession('squash', '2026-03-30', 70, 7),
    makeHistoricalSession('strength', '2026-03-29', 55, 6),
    makeHistoricalSession('strength', '2026-03-27', 50, 6),
  ]

  it('base keeps a more general distribution without warnings', () => {
    const profile = makeProfile({
      goalEvents: [{ ...makeProfile().goalEvents![0], date: '2026-08-15' }],
    })

    const summary = buildMacroWeekCoherenceSummary({
      athleteProfile: profile,
      sessions: [makeSession('squash'), makeSession('squash'), makeSession('strength', 50, 5)],
      historicalSessions,
      referenceDate,
    })

    expect(summary.currentPhase).toBe('base')
    expect(summary.coherenceStatus).toBe('ok')
    expect(summary.targetDistributionBySport.squash).toBe('primary')
    expect(summary.targetDistributionBySport.strength).toBe('support')
  })

  it('build prioritizes primary sport specificity', () => {
    const profile = makeProfile({
      goalEvents: [{ ...makeProfile().goalEvents![0], date: '2026-05-19' }],
    })

    const summary = buildMacroWeekCoherenceSummary({
      athleteProfile: profile,
      sessions: [makeSession('squash'), makeSession('squash'), makeSession('squash', 70, 7), makeSession('strength', 50, 5)],
      historicalSessions,
      referenceDate,
    })

    expect(summary.currentPhase).toBe('build')
    expect(summary.coherenceStatus).toBe('ok')
    expect(summary.weeklyRule.toLowerCase()).toContain('squash')
    expect(summary.actualDistributionBySport.squash).toBe(3)
  })

  it('peak warns when accessory work dominates over the primary sport', () => {
    const profile = makeProfile({
      goalEvents: [{ ...makeProfile().goalEvents![0], date: '2026-05-12' }],
    })

    const summary = buildMacroWeekCoherenceSummary({
      athleteProfile: profile,
      sessions: [makeSession('squash'), makeSession('strength', 60, 6), makeSession('strength', 55, 6)],
      historicalSessions,
      referenceDate,
    })

    expect(summary.currentPhase).toBe('peak')
    expect(summary.coherenceStatus).toBe('warning')
    expect(summary.coherenceIssues.join(' ')).toContain('accesorio')
  })

  it('taper warns when running or accessory load stays too high', () => {
    const profile = makeProfile({
      goalEvents: [{ ...makeProfile().goalEvents![0], date: '2026-04-14' }],
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        complementarySports: ['strength', 'running'],
      },
    })

    const summary = buildMacroWeekCoherenceSummary({
      athleteProfile: profile,
      sessions: [makeSession('squash', 75, 8), makeSession('strength', 60, 7), makeSession('running', 55, 7)],
      historicalSessions,
      referenceDate,
    })

    expect(summary.currentPhase).toBe('taper')
    expect(summary.coherenceStatus).toBe('warning')
    expect(summary.coherenceIssues.join(' ')).toContain('running')
  })

  it('taper warns explicitly when average load stays too high for freshness', () => {
    const profile = makeProfile({
      goalEvents: [{ ...makeProfile().goalEvents![0], date: '2026-04-14' }],
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

    const summary = buildMacroWeekCoherenceSummary({
      athleteProfile: profile,
      sessions: [makeSession('squash', 90, 9), makeSession('squash', 85, 8)],
      historicalSessions,
      referenceDate,
    })

    expect(summary.currentPhase).toBe('taper')
    expect(summary.coherenceStatus).toBe('warning')
    expect(summary.coherenceIssues.join(' ')).toContain('frescura')
  })

  it('produces different coherence guidance for build squash and peak running', () => {
    const squashProfile = makeProfile({
      goalEvents: [{ ...makeProfile().goalEvents![0], date: '2026-05-19' }],
    })
    const runningProfile = makeProfile({
      primarySport: 'running',
      sportContext: {
        enabledSports: ['running', 'strength'],
        primarySport: 'running',
        secondarySports: ['strength'],
        trainingPriority: 'performance',
      },
      goalEvents: [
        {
          ...makeProfile().goalEvents![0],
          sport: 'running',
          title: '10K principal',
          date: '2026-05-20',
        },
      ],
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        complementarySports: ['strength'],
      },
    })

    const buildSummary = buildMacroWeekCoherenceSummary({
      athleteProfile: squashProfile,
      sessions: [makeSession('squash'), makeSession('squash'), makeSession('strength', 50, 5)],
      historicalSessions,
      referenceDate,
    })
    const peakSummary = buildMacroWeekCoherenceSummary({
      athleteProfile: runningProfile,
      sessions: [makeSession('running'), makeSession('running'), makeSession('strength', 45, 5)],
      historicalSessions,
      referenceDate,
    })

    expect(buildSummary.weeklyRule).not.toBe(peakSummary.weeklyRule)
    expect(buildSummary.blockGoal).not.toBe(peakSummary.blockGoal)
  })
})
