import { acknowledgeLocalMembershipCreation, markMembershipsHydrated, replaceMembershipCache } from '../athlete/membershipCache'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../syncService', () => ({
  pushAthlete: vi.fn(async () => {}),
}))

import { db } from '../../db/db'
import {
  archiveManagedAthlete,
  createManagedAthlete,
  listArchivedRosterAthletes,
  listRosterAthletes,
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

  it('un pull anterior al replay conserva el alta pendiente; tras confirmarla, una revocación sí la retira', async () => {
    await replaceMembershipCache('user-1', [])
    const athlete = await createManagedAthlete('user-1', 'Creado offline')

    await replaceMembershipCache('user-1', [])
    expect((await listRosterAthletes('user-1')).map((row) => row.id)).toContain(athlete.id)

    await acknowledgeLocalMembershipCreation('user-1', athlete.id)
    await replaceMembershipCache('user-1', [])
    expect(await listRosterAthletes('user-1')).toEqual([])
  })

  it('si falla el espejo de membresía, revierte el alta local sin empujar', async () => {
    const write = vi.spyOn(db.athleteMemberships, 'bulkPut').mockRejectedValueOnce(new Error('sin espacio'))
    try {
      await expect(createManagedAthlete('user-1', 'Cliente')).rejects.toThrow('sin espacio')
      expect(await db.athletes.count()).toBe(0)
      expect(vi.mocked(syncService.pushAthlete)).not.toHaveBeenCalled()
    } finally {
      write.mockRestore()
    }
  })

  it('listRosterAthletes: solo activos del owner, self primero', async () => {
    const now = Date.now()
    await db.athletes.bulkPut([
      { id: 'ath_m_b', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Bruno', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_a', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Ana', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_other', ownerAccountId: 'user-2', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_x', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'X', status: 'archived', createdAt: now, updatedAt: now },
    ] as never)

    const list = await listRosterAthletes('user-1')

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

    it('listArchivedRosterAthletes devuelve solo los archivados del owner por nombre', async () => {
      await db.athletes.bulkPut([
        { ...managed, id: 'ath_m_b', displayName: 'Beto', status: 'archived' },
        { ...managed, status: 'archived' },
        self,
        { id: 'ath_other', ownerAccountId: 'user-2', status: 'archived', createdAt: now, updatedAt: now },
      ] as never)

      expect((await listArchivedRosterAthletes('user-1')).map((athlete) => athlete.id)).toEqual(['ath_m_a', 'ath_m_b'])
    })
  })
  it('createManagedAthlete anticipa la membresía coach en el espejo local', async () => {
    const athlete = await createManagedAthlete('user-1', 'Cliente 2')

    expect(await db.athleteMemberships.get([athlete.id, 'user-1'])).toMatchObject({ role: 'coach' })
    expect((await listRosterAthletes('user-1')).map((row) => row.id)).toContain(athlete.id)
  })

  it('listRosterAthletes con caché hidratada: incluye el transferido y excluye el propio revocado', async () => {
    await markMembershipsHydrated('user-1')
    const now = Date.now()
    await db.athletes.bulkPut([
      { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_revoked', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Revocado', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'Transferido', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_t_arch', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'Transferido archivado', status: 'archived', createdAt: now, updatedAt: now },
    ] as never)
    await db.athleteMemberships.bulkPut([
      { athleteId: 'ath_user-1', accountId: 'user-1', role: 'self', createdAt: now, updatedAt: now },
      { athleteId: 'ath_m_t', accountId: 'user-1', role: 'coach', createdAt: now, updatedAt: now },
      { athleteId: 'ath_m_t_arch', accountId: 'user-1', role: 'coach', createdAt: now, updatedAt: now },
    ])

    expect((await listRosterAthletes('user-1')).map((row) => row.id)).toEqual(['ath_user-1', 'ath_m_t'])
    expect((await listArchivedRosterAthletes('user-1')).map((row) => row.id)).toEqual(['ath_m_t_arch'])
  })

  it('archiveManagedAthlete acepta un transferido (membresía coach, owner ajeno) y rechaza uno revocado', async () => {
    await markMembershipsHydrated('user-1')
    const now = Date.now()
    await db.athletes.bulkPut([
      { id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'T', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_revoked', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'R', status: 'active', createdAt: now, updatedAt: now },
    ] as never)
    await db.athleteMemberships.put({ athleteId: 'ath_m_t', accountId: 'user-1', role: 'coach', createdAt: now, updatedAt: now })

    const archived = await archiveManagedAthlete('user-1', 'ath_m_t')
    expect(archived.status).toBe('archived')
    expect(vi.mocked(syncService.pushAthlete)).toHaveBeenCalledWith(expect.objectContaining({ id: 'ath_m_t', status: 'archived' }))

    await expect(archiveManagedAthlete('user-1', 'ath_m_revoked')).rejects.toThrow('El atleta no pertenece a esta cuenta.')
  })

})
