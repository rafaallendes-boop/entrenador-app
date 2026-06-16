import { describe, expect, it } from 'vitest'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { generatePlanWeeks } from '../generatePlan'
import { reviewPlanQuality } from '../qualityReview'

function wizard(): PlanWizardConfig {
  return {
    goalEventId: 'event-1',
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    doubleSessionDays: ['monday', 'wednesday', 'friday'],
    sessionsPerWeek: 6,
    sessionDurationMins: 60,
    allowDoubleSession: true,
    complementarySports: ['running', 'strength'],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    createdAt: '',
    updatedAt: '',
  }
}

function profile(): AthleteProfile {
  return {
    id: 'rafa',
    updatedAt: 0,
    name: 'Rafa',
    age: 34,
    primarySport: 'squash',
    sportContext: {
      primarySport: 'squash',
      enabledSports: ['squash', 'running', 'strength', 'mobility'],
      secondarySports: ['running', 'strength', 'mobility'],
      trainingPriority: 'performance',
    },
    strengthProfile: {
      squat1RM: 120,
      deadlift1RM: 140,
      benchPress1RM: 90,
      overheadPress1RM: 65,
    },
    mainGoal: 'Competir mejor',
  } as AthleteProfile
}

function plan(wizardConfig = wizard()): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'rafa',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Plan Nacional',
    startDate: '2026-06-01',
    endDate: '2026-06-20',
    totalWeeks: 3,
    phases: [
      { phase: 'peak', startWeekIndex: 0, endWeekIndex: 0, blockFocus: '', intentBySport: {} },
      { phase: 'taper', startWeekIndex: 1, endWeekIndex: 1, blockFocus: '', intentBySport: {} },
      { phase: 'race', startWeekIndex: 2, endWeekIndex: 2, blockFocus: '', intentBySport: {} },
    ],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-06-20',
      currentPhase: 'peak',
      weeksRemaining: 3,
      blockFocus: '',
      headline: '',
      timeline: [],
      sportDetails: [
        { sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' },
      ],
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 0,
    updatedAt: 0,
  } as TrainingPlan
}

function week(weekIndex: number, weekStartDate: string, phase: TrainingPlanWeek['phase']): TrainingPlanWeek {
  return {
    id: `week-${weekIndex}`,
    planId: 'plan-1',
    weekIndex,
    weekStartDate,
    phase,
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: { squash: 75, strength: 41, running: 41, mobility: 41 },
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 0,
    updatedAt: 0,
  } as TrainingPlanWeek
}

function nestedSquashMinutesAreValid(generatedWeek: TrainingPlanWeek): boolean {
  return generatedWeek.sessions
    .filter((session) => session.sessionType === 'squash')
    .every((session) => {
      const drillTotal = (session.squashDetails?.drills ?? []).reduce((total, drill) => total + drill.durationMin, 0)
      const blockTotal = (session.squashDetails?.blocks ?? []).reduce((total, block) => total + block.durationMin, 0)
      return drillTotal <= session.durationMin && blockTotal <= session.durationMin
    })
}

function invalidSquashTiming(generatedWeek: TrainingPlanWeek): unknown[] {
  return generatedWeek.sessions
    .filter((session) => session.sessionType === 'squash')
    .map((session) => {
      const drillTotal = (session.squashDetails?.drills ?? []).reduce((total, drill) => total + drill.durationMin, 0)
      const blockTotal = (session.squashDetails?.blocks ?? []).reduce((total, block) => total + block.durationMin, 0)
      return { weekIndex: generatedWeek.weekIndex, date: session.date, title: session.title, durationMin: session.durationMin, drillTotal, blockTotal }
    })
    .filter((item) => item.drillTotal > item.durationMin || item.blockTotal > item.durationMin)
}

describe('deterministic primary squash plan generation', () => {
  it('generates a beta-usable squash plan without provider calls', async () => {
    const wizardConfig = wizard()
    const trainingPlan = plan(wizardConfig)
    const weeks = [
      week(0, '2026-06-01', 'peak'),
      week(1, '2026-06-08', 'taper'),
      week(2, '2026-06-15', 'race'),
    ]

    const result = await generatePlanWeeks({
      plan: trainingPlan,
      weeks,
      profile: profile(),
      wizardConfig,
      strategy: 'single',
    })

    expect(result).toHaveLength(3)
    expect(result.every((generatedWeek) => generatedWeek.generationMeta.generationSource === 'deterministic')).toBe(true)
    expect(result.every((generatedWeek) => generatedWeek.generationMeta.fallbackUsed !== true)).toBe(true)

    const peak = result[0]!
    expect(peak.sessions).toHaveLength(6)
    expect(peak.sessions.filter((session) => session.sessionType === 'strength')).toHaveLength(2)
    expect(peak.sessions.some((session) => session.sessionType === 'running')).toBe(true)
    expect(peak.sessions.some((session) => peak.sessions.filter((other) => other.date === session.date).length >= 2)).toBe(true)
    expect(peak.sessions.filter((session) => session.sessionType === 'strength').every((session) => /^Gym Tipo [ABC]/.test(session.title))).toBe(true)

    for (const generatedWeek of result) {
      if (generatedWeek.phase === 'race') {
        expect(generatedWeek.sessions.some((session) => session.sessionType === 'running' || session.sessionType === 'cycling')).toBe(false)
      }
      if (!nestedSquashMinutesAreValid(generatedWeek)) {
        throw new Error(JSON.stringify(invalidSquashTiming(generatedWeek), null, 2))
      }
    }

    const review = reviewPlanQuality(trainingPlan, result)
    if (review.criticalIssueCount !== 0) {
      throw new Error(JSON.stringify(review.issues, null, 2))
    }
    expect(review.score).toBeGreaterThanOrEqual(78)
  })
})
