import { describe, expect, it } from 'vitest'
import {
  resolveCurrentPlanWeekNumber,
  resolvePlanStartDate,
  resolvePlanWeekNumber,
} from '../planBuilder/planProgress'

describe('planProgress', () => {
  it('starts a newly created 12-week plan on week 1 when the event is 11 weeks away', () => {
    expect(resolveCurrentPlanWeekNumber({
      planStartDate: '2026-05-11',
      totalWeeks: 12,
      dateISO: '2026-05-11',
      weeksRemaining: 11,
    })).toBe(1)
  })

  it('advances by calendar weeks from the plan start date', () => {
    expect(resolvePlanWeekNumber({
      planStartDate: '2026-05-11',
      totalWeeks: 12,
      dateISO: '2026-05-18',
    })).toBe(2)
  })

  it('clamps dates before or after the generated plan window', () => {
    expect(resolvePlanWeekNumber({
      planStartDate: '2026-05-11',
      totalWeeks: 12,
      dateISO: '2026-05-04',
    })).toBe(1)

    expect(resolvePlanWeekNumber({
      planStartDate: '2026-05-11',
      totalWeeks: 12,
      dateISO: '2026-09-01',
    })).toBe(12)
  })

  it('uses inclusive fallback math when no plan start date is available', () => {
    expect(resolveCurrentPlanWeekNumber({
      totalWeeks: 12,
      dateISO: '2026-05-11',
      weeksRemaining: 11,
    })).toBe(1)

    expect(resolveCurrentPlanWeekNumber({
      totalWeeks: 12,
      dateISO: '2026-07-27',
      weeksRemaining: 0,
    })).toBe(12)
  })

  it('normalizes wizard creation timestamps to the calendar week start', () => {
    expect(resolvePlanStartDate({
      createdAt: '2026-05-13T18:24:00.000Z',
    })).toBe('2026-05-11')
  })
})
