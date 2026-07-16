import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../syncService', () => ({
  pushAthlete: vi.fn(async () => {}),
}))

import { db } from '../../db/db'
import {
  archiveManagedAthlete,
  createManagedAthlete,
  listArchivedAthletes,
  listOwnedAthletes,
  restoreManagedAthlete,
} from '../athlete/managedAthletes'
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

  describe('archive/restore/listArchived', () => {
    const now = Date.now()
    const managed = { id: 'ath_m_a', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Ana', status: 'active', createdAt: now, updatedAt: now }
    const self = { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now }
    const claimed = { id: 'ath_m_c', ownerAccountId: 'user-1', linkedAccountId: 'user-9', displayName: 'Carla', status: 'active', createdAt: now, updatedAt: now }

    it('archiveManagedAthlete archiva localmente y pushea', async () => {
      await db.athletes.bulkPut([managed, self] as never)

      const result = await archiveManagedAthlete('user-1', 'ath_m_a')

      expect(result.status).toBe('archived')
      expect((await db.athletes.get('ath_m_a'))?.status).toBe('archived')
      expect(vi.mocked(syncService.pushAthlete)).toHaveBeenCalledWith(expect.objectContaining({
        id: 'ath_m_a',
        status: 'archived',
      }))
    })

    it('rechaza self, reclamado, otro owner e inexistente', async () => {
      await db.athletes.bulkPut([managed, self, claimed] as never)

      await expect(archiveManagedAthlete('user-1', 'ath_user-1')).rejects.toThrow(/propio perfil/)
      await expect(archiveManagedAthlete('user-1', 'ath_m_c')).rejects.toThrow(/cuenta vinculada/)
      await expect(archiveManagedAthlete('user-2', 'ath_m_a')).rejects.toThrow(/no pertenece/)
      await expect(archiveManagedAthlete('user-1', 'ath_missing')).rejects.toThrow(/no encontrado/)
      await expect(restoreManagedAthlete('user-1', 'ath_m_c')).rejects.toThrow(/cuenta vinculada/)
    })

    it('restoreManagedAthlete vuelve a active y pushea', async () => {
      await db.athletes.put({ ...managed, status: 'archived' } as never)

      const result = await restoreManagedAthlete('user-1', 'ath_m_a')

      expect(result.status).toBe('active')
      expect((await db.athletes.get('ath_m_a'))?.status).toBe('active')
      expect(vi.mocked(syncService.pushAthlete)).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))
    })

    it('propaga un push rechazado y restaura el estado local anterior', async () => {
      await db.athletes.put(managed as never)
      vi.mocked(syncService.pushAthlete).mockRejectedValueOnce(new Error('scope unavailable'))

      await expect(archiveManagedAthlete('user-1', 'ath_m_a')).rejects.toThrow('scope unavailable')

      expect((await db.athletes.get('ath_m_a'))?.status).toBe('active')
    })

    it('listArchivedAthletes devuelve solo los archivados del owner por nombre', async () => {
      await db.athletes.bulkPut([
        { ...managed, id: 'ath_m_b', displayName: 'Beto', status: 'archived' },
        { ...managed, status: 'archived' },
        self,
        { id: 'ath_other', ownerAccountId: 'user-2', status: 'archived', createdAt: now, updatedAt: now },
      ] as never)

      expect((await listArchivedAthletes('user-1')).map((athlete) => athlete.id)).toEqual(['ath_m_a', 'ath_m_b'])
    })
  })
})
