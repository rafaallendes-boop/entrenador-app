import { describe, it, expect } from 'vitest'
import { validateLoadProgression } from '../validator'
import type { CoachSessionProposal } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

function session(date: string, durationMin: number, rpe: number): CoachSessionProposal {
  return { date, timeBlock: 'AM', sessionType: 'squash', title: 'S', durationMin, rpe }
}

function week(
  weekIndex: number,
  phase: TrainingPlanWeek['phase'],
  sessions: CoachSessionProposal[],
  weekStartDate = '2026-06-01',
): TrainingPlanWeek {
  return {
    id: `w${weekIndex}`, planId: 'p1', weekIndex, weekStartDate, phase,
    status: 'draft', sessions, weekObjectives: [], targetLoadBySport: {},
    validationIssues: [], generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlanWeek
}

function plan(startDate = '2026-06-01'): TrainingPlan {
  return {
    id: 'p1',
    athleteId: 'a1',
    goalEventId: 'e1',
    status: 'draft',
    generationState: 'complete',
    title: 'Plan',
    startDate,
    endDate: '2026-07-31',
    totalWeeks: 8,
    phases: [],
    wizardConfig: {
      goalEventId: 'e1',
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      doubleSessionDays: [],
      sessionsPerWeek: 6,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: [],
      currentFitnessLevel: 'fit',
      currentFatigue: 'fresh',
      createdAt: '',
      updatedAt: '',
    },
    macroSnapshot: {
      goalEventId: 'e1',
      goalEventDate: '2026-07-31',
      currentPhase: 'build',
      weeksRemaining: 8,
      blockFocus: '',
      headline: '',
      timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'maintain', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 0,
    updatedAt: 0,
  } as TrainingPlan
}

describe('validateLoadProgression with partial weeks', () => {
  it('does not flag a load jump caused by a partial first week', () => {
    // Same per-session load; the first week is just shorter (1 session vs 6).
    const partialFirst = week(0, 'build', [session('2026-06-06', 60, 7)])
    const fullSecond = week(1, 'build', Array.from({ length: 6 }, (_, i) => session(`2026-06-1${i}`, 60, 7)), '2026-06-08')

    const issues = validateLoadProgression([partialFirst, fullSecond], plan('2026-06-06'))
    expect(issues.some((i) => i.code === 'plan.load.jump')).toBe(false)
  })

  it('still flags a real per-session intensity jump between full weeks', () => {
    const easyWeek = week(0, 'build', Array.from({ length: 4 }, (_, i) => session(`2026-06-0${i + 1}`, 60, 5)))
    const hardWeek = week(1, 'build', Array.from({ length: 4 }, (_, i) => session(`2026-06-1${i}`, 60, 9)), '2026-06-08')

    const issues = validateLoadProgression([easyWeek, hardWeek], plan())
    expect(issues.some((i) => i.code === 'plan.load.jump')).toBe(true)
  })

  it('flags a real weekly volume jump when the previous week is incomplete', () => {
    const incompleteFirst = week(0, 'build', [
      session('2026-06-01', 60, 7),
      session('2026-06-02', 60, 7),
    ])
    const fullSecond = week(1, 'build', Array.from({ length: 6 }, (_, i) => session(`2026-06-1${i}`, 60, 7)), '2026-06-08')

    const issues = validateLoadProgression([incompleteFirst, fullSecond], plan())
    expect(issues.some((i) => i.code === 'plan.load.jump')).toBe(true)
  })
})
