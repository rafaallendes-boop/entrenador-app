import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { setAccountRole } from '../../entitlements/accountRoleHolder'
import { markMembershipsHydrated } from '../membershipCache'

const fakes = { db }
beforeEach(async () => { db.close(); await db.delete(); await db.open(); setAccountRole('unknown') })
afterEach(() => { db.close(); setAccountRole('unknown') })

import { hydrateActiveAthlete } from '../hydrateActiveAthlete'
import { getActiveAthleteId, setActiveAthleteId, getSelfAthleteId, setSelfAthleteId } from '../activeAthlete'
import { getPersistedAthleteSelection, persistAthleteSelection } from '../athleteSelection'

function installLocalStorage(): void {
  const state = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return state.size
      },
      key: (index: number) => Array.from(state.keys())[index] ?? null,
      getItem: (key: string) => state.get(key) ?? null,
      setItem: (key: string, value: string) => {
        state.set(key, value)
      },
      removeItem: (key: string) => {
        state.delete(key)
      },
      clear: () => {
        state.clear()
      },
    },
  })
}

describe('hydrateActiveAthlete', () => {
  beforeEach(async () => {
    installLocalStorage()
    localStorage.clear()
    await fakes.db.athletes.clear()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('sets activeAthleteId from the local athletes row', async () => {
    const now = Date.now()
    await fakes.db.athletes.put({ id: 'ath_u1', ownerAccountId: 'u1', linkedAccountId: 'u1', status: 'active', createdAt: now, updatedAt: now })
    const id = await hydrateActiveAthlete('u1')
    expect(id).toBe('ath_u1')
    expect(getActiveAthleteId()).toBe('ath_u1')
  })

  it('returns null and stays legacy when no athlete row exists', async () => {
    const id = await hydrateActiveAthlete('u1')
    expect(id).toBeNull()
    expect(getActiveAthleteId()).toBeNull()
  })

  it('also hydrates the self athlete holder', async () => {
    const now = Date.now()
    await fakes.db.athletes.put({ id: 'ath_u1', ownerAccountId: 'u1', linkedAccountId: 'u1', status: 'active', createdAt: now, updatedAt: now })
    await hydrateActiveAthlete('u1')
    expect(getSelfAthleteId()).toBe('ath_u1')
  })
})

describe('hydrateActiveAthlete selection-aware', () => {
  beforeEach(async () => {
    installLocalStorage()
    localStorage.clear()
    await fakes.db.athletes.clear()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('respeta una selección persistida válida (no la pisa con el self)', async () => {
    const now = Date.now()
    await fakes.db.athletes.put({ id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now })
    await fakes.db.athletes.put({ id: 'ath_m_1', ownerAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now })
    persistAthleteSelection('user-1', 'ath_m_1')

    const id = await hydrateActiveAthlete('user-1')

    expect(id).toBe('ath_m_1')
    expect(getActiveAthleteId()).toBe('ath_m_1')
    expect(getSelfAthleteId()).toBe('ath_user-1')
  })

  it('selección inexistente → fallback self + limpieza', async () => {
    const now = Date.now()
    await fakes.db.athletes.put({ id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now })
    persistAthleteSelection('user-1', 'ath_ghost')

    const id = await hydrateActiveAthlete('user-1')

    expect(id).toBe('ath_user-1')
    expect(getPersistedAthleteSelection('user-1')).toBeNull()
  })

  it('selección de otro owner o inactiva → fallback self + limpieza', async () => {
    const now = Date.now()
    await fakes.db.athletes.put({ id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now })
    await fakes.db.athletes.put({ id: 'ath_other', ownerAccountId: 'user-2', status: 'active', createdAt: now, updatedAt: now })
    persistAthleteSelection('user-1', 'ath_other')
    expect(await hydrateActiveAthlete('user-1')).toBe('ath_user-1')
    expect(getPersistedAthleteSelection('user-1')).toBeNull()

    await fakes.db.athletes.put({ id: 'ath_m_2', ownerAccountId: 'user-1', status: 'archived', createdAt: now, updatedAt: now })
    persistAthleteSelection('user-1', 'ath_m_2')
    expect(await hydrateActiveAthlete('user-1')).toBe('ath_user-1')
    expect(getPersistedAthleteSelection('user-1')).toBeNull()
  })

  it('sin selección persistida → self (regresión del comportamiento actual)', async () => {
    const now = Date.now()
    await fakes.db.athletes.put({ id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now })
    const id = await hydrateActiveAthlete('user-1')
    expect(id).toBe('ath_user-1')
    expect(getSelfAthleteId()).toBe('ath_user-1')
  })
  it('un coach confirmado no adopta una fila self residual ni una membresía self residual', async () => {
    setAccountRole('coach')
    await fakes.db.athletes.put({ id: 'ath_coach-1', ownerAccountId: 'coach-1', linkedAccountId: 'coach-1', status: 'active', createdAt: 1, updatedAt: 1 })
    await fakes.db.athleteMemberships.bulkPut([{ athleteId: 'ath_coach-1', accountId: 'coach-1', role: 'self', createdAt: 1, updatedAt: 1 }])

    expect(await hydrateActiveAthlete('coach-1')).toBeNull()
    expect(getSelfAthleteId()).toBeNull()
    expect(getActiveAthleteId()).toBeNull()
    setAccountRole('unknown')
  })

  it('la selección persistida exige elegibilidad Y estado activo (no basta el owner ni la membresía sola)', async () => {
    await markMembershipsHydrated('user-1')
    await fakes.db.athletes.put({ id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: 1, updatedAt: 1 })
    await fakes.db.athletes.put({ id: 'ath_m_owned_no_membership', ownerAccountId: 'user-1', linkedAccountId: null, status: 'active', createdAt: 1, updatedAt: 1 })
    await fakes.db.athletes.put({ id: 'ath_m_archived', ownerAccountId: 'user-9', linkedAccountId: null, status: 'archived', createdAt: 1, updatedAt: 1 })
    await fakes.db.athleteMemberships.bulkPut([
      { athleteId: 'ath_user-1', accountId: 'user-1', role: 'self', createdAt: 1, updatedAt: 1 },
      { athleteId: 'ath_m_archived', accountId: 'user-1', role: 'coach', createdAt: 1, updatedAt: 1 },
      { athleteId: 'ath_m_missing_row', accountId: 'user-1', role: 'coach', createdAt: 1, updatedAt: 1 },
    ])

    for (const invalid of ['ath_m_owned_no_membership', 'ath_m_archived', 'ath_m_missing_row']) {
      persistAthleteSelection('user-1', invalid)
      expect(await hydrateActiveAthlete('user-1')).toBe('ath_user-1')
      expect(getPersistedAthleteSelection('user-1')).toBeNull()
    }
  })

  it('un coach con selección persistida válida la conserva; sin selección queda en none', async () => {
    setAccountRole('coach')
    await markMembershipsHydrated('coach-1')
    await fakes.db.athletes.put({ id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, status: 'active', createdAt: 1, updatedAt: 1 })
    await fakes.db.athleteMemberships.bulkPut([{ athleteId: 'ath_m_t', accountId: 'coach-1', role: 'coach', createdAt: 1, updatedAt: 1 }])

    expect(await hydrateActiveAthlete('coach-1')).toBeNull()
    persistAthleteSelection('coach-1', 'ath_m_t')
    expect(await hydrateActiveAthlete('coach-1')).toBe('ath_m_t')
    expect(getActiveAthleteId()).toBe('ath_m_t')
    setAccountRole('unknown')
  })

})
