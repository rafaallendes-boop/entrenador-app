import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => {
  interface Row { id: string; [k: string]: unknown }
  let rows: Row[] = []
  const athletes = {
    async get(id: string) {
      return rows.find((r) => r.id === id)
    },
    async put(row: Row) {
      rows.push(row)
    },
    async clear() {
      rows = []
    },
  }
  return { db: { athletes } }
})

vi.mock('../../../db/db', () => ({ db: fakes.db }))

import { hydrateActiveAthlete } from '../hydrateActiveAthlete'
import { getActiveAthleteId, setActiveAthleteId } from '../activeAthlete'

describe('hydrateActiveAthlete', () => {
  beforeEach(async () => {
    await fakes.db.athletes.clear()
    setActiveAthleteId(null)
  })

  it('sets activeAthleteId from the local athletes row', async () => {
    const now = Date.now()
    await fakes.db.athletes.put({ id: 'ath_u1', ownerAccountId: 'u1', status: 'active', createdAt: now, updatedAt: now })
    const id = await hydrateActiveAthlete('u1')
    expect(id).toBe('ath_u1')
    expect(getActiveAthleteId()).toBe('ath_u1')
  })

  it('returns null and stays legacy when no athlete row exists', async () => {
    const id = await hydrateActiveAthlete('u1')
    expect(id).toBeNull()
    expect(getActiveAthleteId()).toBeNull()
  })
})
