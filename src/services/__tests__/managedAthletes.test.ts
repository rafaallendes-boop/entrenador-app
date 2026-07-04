import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../syncService', () => ({
  pushAthlete: vi.fn(async () => {}),
}))

import { db } from '../../db/db'
import { createManagedAthlete, listOwnedAthletes } from '../athlete/managedAthletes'
import * as syncService from '../syncService'

describe('managedAthletes', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    vi.clearAllMocks()
  })

  afterEach(() => {
    db.close()
  })

  it('createManagedAthlete persiste local y encola el push', async () => {
    const athlete = await createManagedAthlete('user-1', '  Cliente 1  ')

    expect(athlete.id.startsWith('ath_m_')).toBe(true)
    expect(athlete).toMatchObject({
      ownerAccountId: 'user-1',
      linkedAccountId: null,
      displayName: 'Cliente 1',
      status: 'active',
    })
    expect(await db.athletes.get(athlete.id)).toBeDefined()
    expect(vi.mocked(syncService.pushAthlete)).toHaveBeenCalledWith(expect.objectContaining({ id: athlete.id }))
  })

  it('rechaza displayName vacío', async () => {
    await expect(createManagedAthlete('user-1', '   ')).rejects.toThrow()
    expect(await db.athletes.count()).toBe(0)
  })

  it('listOwnedAthletes: solo activos del owner, self primero', async () => {
    const now = Date.now()
    await db.athletes.bulkPut([
      { id: 'ath_m_b', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Bruno', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_a', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Ana', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_other', ownerAccountId: 'user-2', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_x', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'X', status: 'archived', createdAt: now, updatedAt: now },
    ] as never)

    const list = await listOwnedAthletes('user-1')

    expect(list.map((athlete) => athlete.id)).toEqual(['ath_user-1', 'ath_m_a', 'ath_m_b'])
  })
})
