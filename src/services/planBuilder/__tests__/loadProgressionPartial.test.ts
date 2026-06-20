import { describe, it, expect } from 'vitest'
import { validateLoadProgression } from '../validator'
import type { CoachSessionProposal } from '../../../types'
import type { TrainingPlanWeek } from '../../../types/planBuilder'

function session(date: string, durationMin: number, rpe: number): CoachSessionProposal {
  return { date, timeBlock: 'AM', sessionType: 'squash', title: 'S', durationMin, rpe }
}

function week(weekIndex: number, phase: TrainingPlanWeek['phase'], sessions: CoachSessionProposal[]): TrainingPlanWeek {
  return {
    id: `w${weekIndex}`, planId: 'p1', weekIndex, weekStartDate: '2026-06-01', phase,
    status: 'draft', sessions, weekObjectives: [], targetLoadBySport: {},
    validationIssues: [], generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlanWeek
}

describe('validateLoadProgression with partial weeks', () => {
  it('does not flag a load jump caused by a partial first week', () => {
    // Same per-session load; the first week is just shorter (1 session vs 6).
    const partialFirst = week(0, 'build', [session('2026-06-05', 60, 7)])
    const fullSecond = week(1, 'build', Array.from({ length: 6 }, (_, i) => session(`2026-06-1${i}`, 60, 7)))

    const issues = validateLoadProgression([partialFirst, fullSecond])
    expect(issues.some((i) => i.code === 'plan.load.jump')).toBe(false)
  })

  it('still flags a real per-session intensity jump between full weeks', () => {
    const easyWeek = week(0, 'build', Array.from({ length: 4 }, (_, i) => session(`2026-06-0${i + 1}`, 60, 5)))
    const hardWeek = week(1, 'build', Array.from({ length: 4 }, (_, i) => session(`2026-06-1${i}`, 60, 9)))

    const issues = validateLoadProgression([easyWeek, hardWeek])
    expect(issues.some((i) => i.code === 'plan.load.jump')).toBe(true)
  })
})
