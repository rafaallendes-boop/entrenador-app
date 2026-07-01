import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'

describe('fake-indexeddb harness', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('opens the real Dexie database and round-trips a row', async () => {
    const id = 'smoke-1'
    await db.dayLogs.put({ id, date: '2026-06-30', updatedAt: Date.now() })
    const row = await db.dayLogs.get(id)
    expect(row?.date).toBe('2026-06-30')
  })
})
