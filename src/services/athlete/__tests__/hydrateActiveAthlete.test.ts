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

  it('also hydrates the self athlete holder', async () => {
    const now = Date.now()
    await fakes.db.athletes.put({ id: 'ath_u1', ownerAccountId: 'u1', status: 'active', createdAt: now, updatedAt: now })
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
    await fakes.db.athletes.put({ id: 'ath_user-1', ownerAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now })
    await fakes.db.athletes.put({ id: 'ath_m_1', ownerAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now })
    persistAthleteSelection('user-1', 'ath_m_1')

    const id = await hydrateActiveAthlete('user-1')

    expect(id).toBe('ath_m_1')
    expect(getActiveAthleteId()).toBe('ath_m_1')
    expect(getSelfAthleteId()).toBe('ath_user-1')
  })

  it('selección inexistente → fallback self + limpieza', async () => {
    const now = Date.now()
    await fakes.db.athletes.put({ id: 'ath_user-1', ownerAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now })
    persistAthleteSelection('user-1', 'ath_ghost')

    const id = await hydrateActiveAthlete('user-1')

    expect(id).toBe('ath_user-1')
    expect(getPersistedAthleteSelection('user-1')).toBeNull()
  })

  it('selección de otro owner o inactiva → fallback self + limpieza', async () => {
    const now = Date.now()
    await fakes.db.athletes.put({ id: 'ath_user-1', ownerAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now })
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
    await fakes.db.athletes.put({ id: 'ath_user-1', ownerAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now })
    const id = await hydrateActiveAthlete('user-1')
    expect(id).toBe('ath_user-1')
    expect(getSelfAthleteId()).toBe('ath_user-1')
  })
})
