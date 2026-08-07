import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../../db/db'
import type { WhoopWorkout } from '../../../types'
import { getLocalWhoopWorkoutsInRange } from '../localWhoopWorkouts'

function makeWorkout(overrides: Partial<WhoopWorkout> & { workoutId: string }): WhoopWorkout {
  return {
    id: `whoop:${overrides.athleteId ?? 'self-1'}:${overrides.workoutId}`,
    athleteId: 'self-1',
    date: '2026-08-04',
    sportName: 'running',
    startAt: '2026-08-04T10:00:00.000Z',
    endAt: '2026-08-04T10:30:00.000Z',
    durationMin: 30,
    scoreState: 'SCORED',
    updatedAt: 1,
    ...overrides,
  }
}

describe('getLocalWhoopWorkoutsInRange', () => {
  beforeEach(async () => {
    await db.whoopWorkouts.clear()
  })

  it('includes both range boundaries', async () => {
    await db.whoopWorkouts.bulkAdd([
      makeWorkout({ workoutId: 'before', date: '2026-07-31' }),
      makeWorkout({ workoutId: 'start', date: '2026-08-01' }),
      makeWorkout({ workoutId: 'end', date: '2026-08-07' }),
      makeWorkout({ workoutId: 'after', date: '2026-08-08' }),
    ])

    const rows = await getLocalWhoopWorkoutsInRange('self-1', '2026-08-01', '2026-08-07')

    expect(rows.map((row) => row.workoutId).sort()).toEqual(['end', 'start'])
  })

  it('returns nothing for a managed athlete even when the self has workouts in range', async () => {
    await db.whoopWorkouts.bulkAdd([
      makeWorkout({ workoutId: 'self-a', athleteId: 'self-1' }),
      makeWorkout({ workoutId: 'self-b', athleteId: 'self-1' }),
    ])

    const rows = await getLocalWhoopWorkoutsInRange('managed-9', '2026-08-01', '2026-08-07')

    expect(rows).toEqual([])
  })

  it('sorts ascending by startAt', async () => {
    await db.whoopWorkouts.bulkAdd([
      makeWorkout({ workoutId: 'late', startAt: '2026-08-04T18:00:00.000Z' }),
      makeWorkout({ workoutId: 'early', startAt: '2026-08-04T07:00:00.000Z' }),
    ])

    const rows = await getLocalWhoopWorkoutsInRange('self-1', '2026-08-01', '2026-08-07')

    expect(rows.map((row) => row.workoutId)).toEqual(['early', 'late'])
  })
})
