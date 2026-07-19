import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'

describe('Dexie v18 upgrade', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
  })

  it('preserva datos v17 y agrega el store sessionTemplates', async () => {
    const legacy = new Dexie('EntrenadorDB')
    legacy.version(17).stores({
      sessions: 'id, date, weekStartDate, type, status, completedAt, athleteId',
      athleteMemberships: '[athleteId+accountId], accountId, athleteId, role',
    })
    await legacy.open()
    await legacy.table('sessions').put({ id: 's1', title: 'Drills' })
    legacy.close()

    await db.open()
    expect((await db.sessions.get('s1'))?.title).toBe('Drills')
    await db.sessionTemplates.put({
      id: 't1',
      name: 'Drills volea',
      kind: 'session',
      payloadVersion: 1,
      payload: {
        type: 'squash', timeBlock: 'AM', title: 'Drills volea', durationMin: 60,
      },
      createdAt: 1,
      updatedAt: 1,
    })
    expect(await db.sessionTemplates.count()).toBe(1)
    expect((await db.sessionTemplates.get('t1'))?.name).toBe('Drills volea')
  })
})
