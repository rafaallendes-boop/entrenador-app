import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../db/db'
import {
  areMembershipsHydrated,
  hasCoachMembership,
  markMembershipsHydrated,
  putLocalMembership,
  replaceMembershipCache,
} from '../membershipCache'
import { legacyAccessFor, listRosterEntries, resolveRosterEntry } from '../coachRosterEligibility'

const now = Date.now()
const ME = 'user-1'
const OTHER = 'user-9'

function installLocalStorage(): void {
  const state = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return state.size },
      key: (index: number) => Array.from(state.keys())[index] ?? null,
      getItem: (key: string) => state.get(key) ?? null,
      setItem: (key: string, value: string) => { state.set(key, value) },
      removeItem: (key: string) => { state.delete(key) },
      clear: () => { state.clear() },
    },
  })
}

async function seedAthletes() {
  await db.athletes.bulkPut([
    { id: 'ath_user-1', ownerAccountId: ME, linkedAccountId: ME, status: 'active', createdAt: now, updatedAt: now },
    { id: 'ath_m_own', ownerAccountId: ME, linkedAccountId: null, displayName: 'Propio', status: 'active', createdAt: now, updatedAt: now },
    { id: 'ath_m_transferred', ownerAccountId: OTHER, linkedAccountId: null, displayName: 'Transferido', status: 'active', createdAt: now, updatedAt: now },
    { id: 'ath_m_foreign', ownerAccountId: OTHER, linkedAccountId: null, displayName: 'Ajeno', status: 'active', createdAt: now, updatedAt: now },
  ] as never)
}

describe('coachRosterEligibility', () => {
  beforeEach(async () => {
    installLocalStorage()
    db.close()
    await db.delete()
    await db.open()
    await seedAthletes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  it('una revocación persiste al reabrir Dexie aunque localStorage falle', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('storage bloqueado') })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('storage bloqueado') })
    await replaceMembershipCache(ME, [])
    db.close()
    await db.open()

    expect(await areMembershipsHydrated(ME)).toBe(true)
    expect(await resolveRosterEntry(ME, 'ath_m_own')).toBeNull()
  })

  it('un fallo al guardar el marcador revierte también el reemplazo de membresías', async () => {
    await putLocalMembership(ME, 'ath_m_own', 'coach')
    vi.spyOn(db.membershipSnapshots, 'put').mockRejectedValueOnce(new Error('sin espacio'))

    await expect(replaceMembershipCache(ME, [])).rejects.toThrow('sin espacio')
    expect(await hasCoachMembership(ME, 'ath_m_own')).toBe(true)
    expect(await areMembershipsHydrated(ME)).toBe(false)
  })

  it('caché hidratada: la membresía es la única autoridad, también para un atleta propio', async () => {
    await replaceMembershipCache(ME, [
      { athleteId: 'ath_m_transferred', accountId: ME, role: 'coach', createdAt: now, updatedAt: now },
      { athleteId: 'ath_user-1', accountId: ME, role: 'self', createdAt: now, updatedAt: now },
    ])
    expect(await areMembershipsHydrated(ME)).toBe(true)

    const entries = await listRosterEntries(ME)

    expect(entries.map((entry) => [entry.athlete.id, entry.access])).toEqual([
      ['ath_user-1', 'self'],
      ['ath_m_transferred', 'coach'],
    ])
    // Propio por owner pero sin membresía: fuera.
    expect(await resolveRosterEntry(ME, 'ath_m_own')).toBeNull()
    expect(await resolveRosterEntry(ME, 'ath_m_foreign')).toBeNull()
  })

  it('una revocación que vacía la caché hidratada NO reabre el acceso por owner', async () => {
    await replaceMembershipCache(ME, [
      { athleteId: 'ath_m_own', accountId: ME, role: 'coach', createdAt: now, updatedAt: now },
    ])
    expect(await resolveRosterEntry(ME, 'ath_m_own')).toMatchObject({ access: 'coach' })

    // Segundo pull exitoso: cero membresías. Es la situación que la ronda
    // anterior del plan convertía en «autoriza por owner».
    await replaceMembershipCache(ME, [])

    expect(await db.athleteMemberships.count()).toBe(0)
    expect(await listRosterEntries(ME)).toEqual([])
    expect(await resolveRosterEntry(ME, 'ath_m_own')).toBeNull()
    expect(await resolveRosterEntry(ME, 'ath_user-1')).toBeNull()
  })

  it('caché NO hidratada: la membresía manda donde existe y la clasificación legacy cubre el resto', async () => {
    expect(await areMembershipsHydrated(ME)).toBe(false)
    // Espejo optimista (Task 2) sin pull previo.
    await putLocalMembership(ME, 'ath_m_transferred', 'coach')

    const entries = await listRosterEntries(ME)

    expect(entries.map((entry) => [entry.athlete.id, entry.access])).toEqual([
      ['ath_user-1', 'self'],
      ['ath_m_own', 'coach'],
      ['ath_m_transferred', 'coach'],
    ])
    expect(await resolveRosterEntry(ME, 'ath_m_foreign')).toBeNull()
  })

  it('el marcador es por cuenta', async () => {
    await markMembershipsHydrated(ME)
    expect(await areMembershipsHydrated(ME)).toBe(true)
    expect(await areMembershipsHydrated(OTHER)).toBe(false)
  })

  it('legacyAccessFor replica el backfill de membresías de 013b', () => {
    const base = { status: 'active', createdAt: now, updatedAt: now }
    expect(legacyAccessFor(ME, { id: 'a', ownerAccountId: ME, linkedAccountId: ME, ...base })).toBe('self')
    expect(legacyAccessFor(ME, { id: 'b', ownerAccountId: ME, linkedAccountId: null, ...base })).toBe('coach')
    expect(legacyAccessFor(ME, { id: 'c', ownerAccountId: ME, linkedAccountId: OTHER, ...base })).toBe('coach')
    expect(legacyAccessFor(ME, { id: 'd', ownerAccountId: OTHER, linkedAccountId: ME, ...base })).toBe('self')
    expect(legacyAccessFor(ME, { id: 'e', ownerAccountId: OTHER, linkedAccountId: null, ...base })).toBeNull()
  })

  it('un self ajeno nunca es elegible aunque el actor tenga otras membresías coach', async () => {
    await db.athletes.put({ id: 'ath_user-9', ownerAccountId: OTHER, linkedAccountId: OTHER, status: 'active', createdAt: now, updatedAt: now } as never)
    await db.athleteMemberships.put({ athleteId: 'ath_m_transferred', accountId: ME, role: 'coach', createdAt: now, updatedAt: now })

    expect(await resolveRosterEntry(ME, 'ath_user-9')).toBeNull()
  })

  it('resolveRosterEntry devuelve null para un atleta inexistente', async () => {
    expect(await resolveRosterEntry(ME, 'ath_nope')).toBeNull()
  })

  it('putLocalMembership es idempotente y hasCoachMembership distingue el rol', async () => {
    await putLocalMembership(ME, 'ath_m_own', 'coach')
    await putLocalMembership(ME, 'ath_m_own', 'coach')
    await putLocalMembership(ME, 'ath_user-1', 'self')

    expect(await db.athleteMemberships.count()).toBe(2)
    expect(await hasCoachMembership(ME, 'ath_m_own')).toBe(true)
    expect(await hasCoachMembership(ME, 'ath_user-1')).toBe(false)
    expect(await hasCoachMembership(OTHER, 'ath_m_own')).toBe(false)
  })
})
