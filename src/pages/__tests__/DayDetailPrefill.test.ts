import { describe, expect, it } from 'vitest'
import {
  buildDayLogSavePatch,
  buildWhoopPrefillSavePatch,
  canAutoPersistWhoopPrefill,
  hasDayLogPrefillPatch,
} from '../../services/readiness/dayLogPrefillSave'
import type { DayLog } from '../../types'

describe('buildDayLogSavePatch', () => {
  it('preserves existing WHOOP source when saving unrelated fields', () => {
    const dayLog: DayLog = {
      id: 'day-1',
      date: '2026-06-21',
      energyLevel: 7,
      prefillSource: { energyLevel: 'whoop' },
      updatedAt: 1,
    }

    const patch = buildDayLogSavePatch({ painLevel: 2 }, dayLog)

    expect(patch).toEqual({
      painLevel: 2,
      prefillSource: { energyLevel: 'whoop' },
    })
  })

  it('does not invent WHOOP source when no prefill exists', () => {
    const patch = buildDayLogSavePatch({ painLevel: 2 })

    expect(patch).toEqual({ painLevel: 2, prefillSource: undefined })
  })

  it('clears WHOOP source when the athlete edits that field', () => {
    const dayLog: DayLog = {
      id: 'day-1',
      date: '2026-06-21',
      prefillSource: {
        sleepHours: 'whoop',
        sleepQuality: 'whoop',
      },
      updatedAt: 1,
    }

    const patch = buildDayLogSavePatch({ sleepHours: 7 }, dayLog, ['sleepHours'])

    expect(patch).toEqual({
      sleepHours: 7,
      prefillSource: { sleepQuality: 'whoop' },
    })
  })
})

describe('buildWhoopPrefillSavePatch', () => {
  it('persists WHOOP prefill values as the default check-in data', () => {
    const prefill = {
      patch: {
        sleepHours: 7.3,
        sleepQuality: 4,
        energyLevel: 8,
      },
      prefillSource: {
        sleepHours: 'whoop',
        sleepQuality: 'whoop',
        energyLevel: 'whoop',
      },
    } as const

    expect(hasDayLogPrefillPatch(prefill)).toBe(true)
    expect(buildWhoopPrefillSavePatch(prefill)).toEqual({
      sleepHours: 7.3,
      sleepQuality: 4,
      energyLevel: 8,
      prefillSource: {
        sleepHours: 'whoop',
        sleepQuality: 'whoop',
        energyLevel: 'whoop',
      },
    })
  })
})

describe('canAutoPersistWhoopPrefill', () => {
  it('allows only today, self athlete and matching readiness athlete', () => {
    expect(canAutoPersistWhoopPrefill({
      date: '2026-07-08',
      today: '2026-07-08',
      activeAthleteId: 'ath_user-1',
      selfAthleteId: 'ath_user-1',
      readinessAthleteId: 'ath_user-1',
    })).toBe(true)
  })

  it('blocks historical days, managed athletes and stale readiness', () => {
    const base = {
      date: '2026-07-08',
      today: '2026-07-08',
      activeAthleteId: 'ath_user-1',
      selfAthleteId: 'ath_user-1',
      readinessAthleteId: 'ath_user-1',
    }

    expect(canAutoPersistWhoopPrefill({ ...base, date: '2026-07-07' })).toBe(false)
    expect(canAutoPersistWhoopPrefill({ ...base, activeAthleteId: 'ath_managed' })).toBe(false)
    expect(canAutoPersistWhoopPrefill({ ...base, readinessAthleteId: 'ath_other' })).toBe(false)
  })
})
