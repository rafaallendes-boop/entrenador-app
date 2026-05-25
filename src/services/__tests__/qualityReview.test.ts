import { describe, expect, it } from 'vitest'
import type { CoachSessionProposal, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { reviewPlanQuality } from '../planBuilder/qualityReview'

function makeWizardConfig(): PlanWizardConfig {
  return {
    goalEventId: 'event-1',
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    sessionsPerWeek: 5,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['running', 'strength'],
    currentFitnessLevel: 'normal',
    currentFatigue: 'fresh',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  }
}

function makePlan(): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'complete',
    title: 'Plan Nacional',
    startDate: '2026-05-04',
    endDate: '2026-06-01',
    totalWeeks: 1,
    phases: [],
    wizardConfig: makeWizardConfig(),
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-06-01',
      currentPhase: 'peak',
      weeksRemaining: 4,
      blockFocus: 'Peak',
      headline: 'Peak',
      timeline: [],
      sportDetails: [{
        sport: 'squash',
        role: 'primary',
        phaseFocus: 'Peak',
        weeklyIntent: 'Priorizar calidad competitiva',
        volumeBias: 'hold',
        intensityBias: 'hold',
        notes: 'Test',
      }],
      secondaryEvents: [],
      computedAt: 1,
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function squash(date: string, title: string): CoachSessionProposal {
  return {
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    title,
    durationMin: 60,
    rpe: 7,
    objective: 'Trabajo específico',
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'technical',
      drills: [
        { name: 'Drive cruzado', durationMin: 12 },
        { name: 'Boast y recuperación', durationMin: 12 },
      ],
    },
  }
}

function makeWeek(sessions: CoachSessionProposal[]): TrainingPlanWeek {
  return {
    id: 'week-1',
    planId: 'plan-1',
    weekIndex: 0,
    weekStartDate: '2026-05-04',
    phase: 'peak',
    status: 'draft',
    sessions,
    weekObjectives: [{ goal: 'Priorizar sesiones clave con volumen controlado.' }],
    targetLoadBySport: { squash: 70, running: 15, strength: 15 },
    validationIssues: [],
    generationMeta: { attempts: 1, repairedSessionCount: 2 },
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('reviewPlanQuality', () => {
  it('scores a complete squash plan week as good or better', () => {
    const plan = makePlan()
    const week = makeWeek([
      squash('2026-05-04', 'Squash técnico'),
      squash('2026-05-05', 'Squash control'),
      squash('2026-05-06', 'Squash juego'),
      {
        date: '2026-05-07',
        timeBlock: 'AM',
        sessionType: 'running',
        title: 'Tempo',
        durationMin: 60,
        rpe: 6,
        runningType: 'tempo',
        targetPaceMin: '4:25',
        targetPaceMax: '4:35',
        intervalStructure: { blocks: [{ label: 'Tempo', durationMin: 30, targetPace: '4:25-4:35 /km' }] },
      },
      {
        date: '2026-05-08',
        timeBlock: 'AM',
        sessionType: 'strength',
        title: 'Fuerza soporte',
        durationMin: 60,
        rpe: 6,
        exercises: [
          { name: 'Dead bug', sets: 3, reps: 8, group: 'core' },
          { name: 'Plancha lateral', sets: 3, reps: '30s', group: 'core' },
          { name: 'Sentadilla frontal', sets: 4, reps: 4, group: 'legs' },
          { name: 'Press Z', sets: 4, reps: 4, group: 'push' },
          { name: 'Peso muerto rumano', sets: 3, reps: 6, group: 'legs' },
          { name: 'Remo unilateral', sets: 3, reps: 8, group: 'pull' },
        ],
      },
    ])

    const review = reviewPlanQuality(plan, [week])

    expect(review.score).toBeGreaterThanOrEqual(78)
    expect(review.grade).not.toBe('poor')
    expect(review.weeks[0]?.repairCount).toBe(2)
  })

  it('penalizes missing support work and incomplete session details', () => {
    const plan = makePlan()
    const week = makeWeek([
      squash('2026-05-04', 'Squash 1'),
      squash('2026-05-05', 'Squash 2'),
      squash('2026-05-06', 'Squash 3'),
      squash('2026-05-07', 'Squash 4'),
      squash('2026-05-08', 'Squash 5'),
    ])

    const review = reviewPlanQuality(plan, [week])

    expect(review.score).toBeLessThan(90)
    expect(review.issues.some((item) => item.code === 'quality.support.missing_strength')).toBe(true)
    expect(review.issues.some((item) => item.code === 'quality.support.missing_aerobic')).toBe(true)
  })
})
