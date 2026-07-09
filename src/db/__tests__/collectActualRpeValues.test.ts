import { describe, expect, it } from 'vitest'

import { collectActualRpeValues } from '../queries'

describe('collectActualRpeValues', () => {
  it('includes session RPE and manual dayLog fallback, but excludes Whoop-prefilled effort', () => {
    const realized = [
      { date: '2026-07-01', actualRpe: 8 },     // session RPE → included
      { date: '2026-07-02', actualRpe: null },  // no session RPE → eligible for dayLog fallback
      { date: '2026-07-03', actualRpe: null },  // no session RPE, but dayLog is Whoop → excluded
    ]
    const dayLogs = [
      { date: '2026-07-02', rpeActual: 6 },                                              // manual → included
      { date: '2026-07-03', rpeActual: 7, prefillSource: { rpeActual: 'whoop' as const } }, // Whoop → excluded
    ]

    expect(collectActualRpeValues(realized, dayLogs).sort((a, b) => a - b)).toEqual([6, 8])
  })

  it('does not use the dayLog fallback when the day has multiple completed sessions', () => {
    const realized = [
      { date: '2026-07-02', actualRpe: null },
      { date: '2026-07-02', actualRpe: null },
    ]
    const dayLogs = [{ date: '2026-07-02', rpeActual: 6 }]

    expect(collectActualRpeValues(realized, dayLogs)).toEqual([])
  })

  it('does not use the dayLog fallback when the single session already has its own RPE', () => {
    const realized = [{ date: '2026-07-02', actualRpe: 9 }]
    const dayLogs = [{ date: '2026-07-02', rpeActual: 6 }]

    expect(collectActualRpeValues(realized, dayLogs)).toEqual([9])
  })
})
