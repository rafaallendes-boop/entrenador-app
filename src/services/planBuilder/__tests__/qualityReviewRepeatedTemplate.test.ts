import { describe, expect, it } from 'vitest'
import type { CoachSessionProposal, PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { reviewPlanQuality } from '../qualityReview'

function plan(): TrainingPlan {
  const wizardConfig: PlanWizardConfig = {
    goalEventId: 'e1',
    trainingDays: ['monday', 'tuesday'],
    sessionsPerWeek: 2,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['strength'],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    createdAt: '',
    updatedAt: '',
  }
  return {
    id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'complete',
    title: 'Test', startDate: '2026-06-01', endDate: '2026-06-14', totalWeeks: 2,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'e1', goalEventDate: '2026-06-14', currentPhase: 'build', weeksRemaining: 2,
      blockFocus: '', headline: '', timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [], computedAt: 0,
    },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlan
}

function strength(exerciseNames: string[]): CoachSessionProposal {
  return {
    date: '2026-06-01',
    timeBlock: 'AM',
    sessionType: 'strength',
    title: 'Fuerza',
    objective: 'Fuerza',
    durationMin: 60,
    rpe: 6,
    exercises: exerciseNames.map((name) => ({ name, sets: 3, reps: 5, group: name === 'Dead bug' ? 'core' : 'legs' })),
  }
}

function week(weekIndex: number, exerciseNames: string[]): TrainingPlanWeek {
  return {
    id: `w${weekIndex}`, planId: 'p1', weekIndex, weekStartDate: weekIndex === 0 ? '2026-06-01' : '2026-06-08',
    phase: 'build', status: 'draft', sessions: [strength(exerciseNames)],
    weekObjectives: [], targetLoadBySport: { strength: 100 }, validationIssues: [],
    generationMeta: { attempts: 1 }, createdAt: 0, updatedAt: 0,
  } as TrainingPlanWeek
}

describe('qualityReview repeated strength templates', () => {
  it('warns when two weeks of the same block share at least 3 exercises', () => {
    const review = reviewPlanQuality(plan(), [
      week(0, ['Dead bug', 'Back squat', 'Bench press', 'Pull up']),
      week(1, ['Dead bug', 'Back squat', 'Bench press', 'Farmer carry']),
    ])

    expect(review.issues.some((issue) => issue.code === 'quality.strength.repeated_template')).toBe(true)
  })

  it('does not warn when weeks share fewer than 3 exercises', () => {
    const review = reviewPlanQuality(plan(), [
      week(0, ['Dead bug', 'Back squat', 'Bench press']),
      week(1, ['Side plank', 'Front squat', 'Incline dumbbell press']),
    ])

    expect(review.issues.some((issue) => issue.code === 'quality.strength.repeated_template')).toBe(false)
  })
})
