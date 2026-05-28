import { describe, expect, it } from 'vitest'
import { computeWeekIndexInBlock } from '../repairWeek'

describe('computeWeekIndexInBlock', () => {
  it('returns 0 when the week falls outside declared phases', () => {
    expect(computeWeekIndexInBlock({
      planPhases: [
        { startWeekIndex: 0, endWeekIndex: 3 },
        { startWeekIndex: 4, endWeekIndex: 6 },
      ],
      weekIndex: 7,
    })).toBe(0)
  })

  it('returns the relative index inside a containing phase', () => {
    expect(computeWeekIndexInBlock({
      planPhases: [
        { startWeekIndex: 0, endWeekIndex: 3 },
        { startWeekIndex: 4, endWeekIndex: 6 },
      ],
      weekIndex: 5,
    })).toBe(1)
  })
})
