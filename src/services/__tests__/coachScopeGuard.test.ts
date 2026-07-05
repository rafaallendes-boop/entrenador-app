import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../syncService', () => ({
  pushAthlete: vi.fn(async () => {}),
  canWriteAthleteProfileLocally: vi.fn(() => true),
}))

import { db } from '../../db/db'
import { getActiveAthleteId, setActiveAthleteId, setSelfAthleteId } from '../athlete/activeAthlete'
import { getPersistedAthleteSelection, persistAthleteSelection } from '../athlete/athleteSelection'
import { enforceCoachScopeGuard } from '../athlete/coachScopeGuard'

const OWNER = 'user-1'
const SELF = 'ath_user-1'
const MANAGED = 'ath_m_abc'
const COACH_USER = { id: OWNER, email: 'rafa@x.cl' }

// El env de test (node) no trae localStorage: instalar uno in-memory.
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

describe('enforceCoachScopeGuard', () => {
  beforeEach(async () => {
    installLocalStorage()
    db.close()
    await db.delete()
    await db.open()
    localStorage.clear()
    await db.athletes.bulkPut([
      { id: SELF, ownerAccountId: OWNER, linkedAccountId: OWNER, displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 },
      { id: MANAGED, ownerAccountId: OWNER, linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 },
    ])
    setSelfAthleteId(SELF)
  })

  afterEach(() => {
    db.close()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('cuenta FUERA de allowlist con gestionado activo: vuelve al self y limpia la selección', async () => {
    setActiveAthleteId(MANAGED)
    persistAthleteSelection(OWNER, MANAGED)

    const enforced = await enforceCoachScopeGuard(COACH_USER, '') // allowlist vacía

    expect(enforced).toBe(true)
    expect(getActiveAthleteId()).toBe(SELF)
    expect(getPersistedAthleteSelection(OWNER)).toBeNull()
  })

  it('coach allowlisted con gestionado activo: no interviene', async () => {
    setActiveAthleteId(MANAGED)
    persistAthleteSelection(OWNER, MANAGED)

    const enforced = await enforceCoachScopeGuard(COACH_USER, 'rafa@x.cl')

    expect(enforced).toBe(false)
    expect(getActiveAthleteId()).toBe(MANAGED)
  })

  it('self activo o holder sin resolver: no-op', async () => {
    setActiveAthleteId(SELF)
    expect(await enforceCoachScopeGuard(COACH_USER, '')).toBe(false)

    setActiveAthleteId(null)
    setSelfAthleteId(null)
    expect(await enforceCoachScopeGuard(COACH_USER, '')).toBe(false)
  })
})
