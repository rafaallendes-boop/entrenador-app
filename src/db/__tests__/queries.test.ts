import { describe, expect, it } from 'vitest'

import type { WeekSummary } from '../../types'
import { hasWeekSummaryMeaningfulChanges } from '../queries'

function makeWeekSummary(overrides: Partial<WeekSummary> = {}): WeekSummary {
  return {
    id: 'week-1',
    weekStartDate: '2026-04-06',
    updatedAt: 100,
    totalSessions: 3,
    totalMinutes: 180,
    plannedSessions: 3,
    completedSessions: 2,
    plannedMinutes: 180,
    completedMinutes: 120,
    adherencePct: 67,
    squashSessions: 1,
    runningSessions: 1,
    strengthSessions: 1,
    objectives: ['base aerobica', 'fuerza soporte'],
    ...overrides,
  }
}

describe('hasWeekSummaryMeaningfulChanges', () => {
  it('returns false when a recalculation produces the same summary values', () => {
    const existing = makeWeekSummary()

    expect(hasWeekSummaryMeaningfulChanges(existing, {
      totalSessions: 3,
      totalMinutes: 180,
      plannedSessions: 3,
      completedSessions: 2,
      plannedMinutes: 180,
      completedMinutes: 120,
      adherencePct: 67,
      squashSessions: 1,
      runningSessions: 1,
      strengthSessions: 1,
      objectives: ['base aerobica', 'fuerza soporte'],
    })).toBe(false)
  })

  it('returns true when any persisted value actually changes', () => {
    const existing = makeWeekSummary()

    expect(hasWeekSummaryMeaningfulChanges(existing, {
      completedMinutes: 140,
    })).toBe(true)
  })
})
