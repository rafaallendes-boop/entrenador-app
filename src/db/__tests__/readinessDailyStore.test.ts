import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'

describe('readinessDaily store (v15)', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('stores and reads a readiness row by athlete and date', async () => {
    await db.readinessDaily.put({
      id: 'whoop:ath_1:2026-06-21',
      athleteId: 'ath_1',
      date: '2026-06-21',
      recoveryScore: 28,
      sleepHours: 5.2,
      sleepPerformance: 61,
      strain: 14.1,
      source: 'whoop',
      updatedAt: Date.now(),
    })
    await db.readinessDaily.put({
      id: 'whoop:ath_2:2026-06-21',
      athleteId: 'ath_2',
      date: '2026-06-21',
      recoveryScore: 75,
      source: 'whoop',
      updatedAt: Date.now(),
    })

    const row = await db.readinessDaily
      .where('[athleteId+date+source]')
      .equals(['ath_1', '2026-06-21', 'whoop'])
      .first()

    expect(row?.recoveryScore).toBe(28)
  })
})
