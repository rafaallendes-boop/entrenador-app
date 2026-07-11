import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'

describe('Dexie v17 upgrade', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
  })

  it('preserves v16 data and adds membership and coach-note stores', async () => {
    const legacy = new Dexie('EntrenadorDB')
    legacy.version(16).stores({
      sessions: 'id, date, weekStartDate, type, status, completedAt, athleteId',
      whoopWorkouts: 'id, date, athleteId, updatedAt, &workoutId',
    })
    await legacy.open()
    await legacy.table('sessions').put({ id: 's1', title: 'Drills' })
    legacy.close()

    await db.open()
    expect((await db.sessions.get('s1'))?.title).toBe('Drills')
    await db.athleteMemberships.put({
      athleteId: 'ath_1', accountId: 'u1', role: 'self', createdAt: 1, updatedAt: 1,
    })
    await db.athleteCoachNotes.put({ athleteId: 'ath_1', coachMemory: 'lefty', updatedAt: 1 })
    expect(await db.athleteMemberships.count()).toBe(1)
    expect((await db.athleteCoachNotes.get('ath_1'))?.coachMemory).toBe('lefty')
  })
})
