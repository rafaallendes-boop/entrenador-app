import { describe, expect, it } from 'vitest'
import type { TrainingPlanWeek } from '../../../types/planBuilder'
import { countReadyWeeks, isReadyWeek, sortWeeks } from '../weekUtils'

function makeWeek(overrides: Partial<TrainingPlanWeek> = {}): TrainingPlanWeek {
  return {
    id: 'w1',
    planId: 'p1',
    weekIndex: 0,
    weekStartDate: '2026-06-01',
    phase: 'build',
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('isReadyWeek', () => {
  it('returns true for draft week with sessions', () => {
    expect(isReadyWeek(makeWeek({ status: 'draft', sessions: [{}] as never }))).toBe(true)
  })

  it('returns true for accepted week with sessions', () => {
    expect(isReadyWeek(makeWeek({ status: 'accepted', sessions: [{}] as never }))).toBe(true)
  })

  it('returns false for draft week with no sessions', () => {
    expect(isReadyWeek(makeWeek({ status: 'draft', sessions: [] }))).toBe(false)
  })

  it('returns false for pending week', () => {
    expect(isReadyWeek(makeWeek({ status: 'pending', sessions: [{}] as never }))).toBe(false)
  })

  it('returns false for error week', () => {
    expect(isReadyWeek(makeWeek({ status: 'error', sessions: [] }))).toBe(false)
  })
})

describe('countReadyWeeks', () => {
  it('counts both draft and accepted weeks with sessions', () => {
    const weeks = [
      makeWeek({ weekIndex: 0, status: 'draft', sessions: [{}] as never }),
      makeWeek({ weekIndex: 1, status: 'accepted', sessions: [{}] as never }),
      makeWeek({ weekIndex: 2, status: 'pending', sessions: [] }),
      makeWeek({ weekIndex: 3, status: 'error', sessions: [] }),
    ]
    expect(countReadyWeeks(weeks)).toBe(2)
  })
})

describe('sortWeeks', () => {
  it('orders weeks by weekIndex ascending', () => {
    const weeks = [
      makeWeek({ weekIndex: 2 }),
      makeWeek({ weekIndex: 0 }),
      makeWeek({ weekIndex: 1 }),
    ]
    expect(sortWeeks(weeks).map((w) => w.weekIndex)).toEqual([0, 1, 2])
  })

  it('does not mutate the original array', () => {
    const weeks = [makeWeek({ weekIndex: 1 }), makeWeek({ weekIndex: 0 })]
    sortWeeks(weeks)
    expect(weeks[0].weekIndex).toBe(1)
  })
})
