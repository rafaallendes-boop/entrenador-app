import { markMembershipsHydrated } from '../athlete/membershipCache'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../syncService', () => ({
  pushAthlete: vi.fn(async () => {}),
  pushAthleteProfile: vi.fn(async () => {}),
  pushCoachProposal: vi.fn(async () => {}),
  pushSession: vi.fn(async () => {}),
  pushDayLog: vi.fn(async () => {}),
  pushWeekSummary: vi.fn(async () => {}),
  pushChatMessage: vi.fn(async () => {}),
  pushTrainingPlan: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  deleteChatMessages: vi.fn(async () => {}),
  deleteCoachProposals: vi.fn(async () => {}),
  canWriteAthleteProfileLocally: vi.fn(() => true),
}))

vi.mock('../readiness/pullWorkouts', () => ({
  pullWorkouts: vi.fn(async () => {}),
}))
vi.mock('../readiness/autoCompleteFromWorkouts', () => ({
  autoCompleteFromWorkouts: vi.fn(async () => {}),
}))

import { db } from '../../db/db'
import {
  ATHLETE_PROFILE_LOCAL_ID,
  getActiveAthleteId,
  getSwitchEpoch,
  setActiveAthleteId,
  setSelfAthleteId,
} from '../athlete/activeAthlete'
import { getPersistedAthleteSelection } from '../athlete/athleteSelection'
import { switchActiveAthlete, clearActiveAthleteSelection } from '../athlete/switchActiveAthlete'
import { useAuthStore } from '../../store/useAuthStore'
import { useCoachMemoryStore } from '../../store/useCoachMemoryStore'
import { pullWorkouts } from '../readiness/pullWorkouts'
import { autoCompleteFromWorkouts } from '../readiness/autoCompleteFromWorkouts'

const OWNER = 'user-1'
const SELF = 'ath_user-1'
const MANAGED = 'ath_m_abc'

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

function seedAthletes() {
  return db.athletes.bulkPut([
    {
      id: SELF,
      ownerAccountId: OWNER,
      linkedAccountId: OWNER,
      displayName: 'Rafa',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: MANAGED,
      ownerAccountId: OWNER,
      linkedAccountId: null,
      displayName: 'Cliente 1',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    },
  ])
}

describe('switchActiveAthlete', () => {
  const originalLoadMemory = useCoachMemoryStore.getState().loadMemory

  beforeEach(async () => {
    vi.clearAllMocks()
    installLocalStorage()
    db.close()
    await db.delete()
    await db.open()
    localStorage.clear()
    setSelfAthleteId(SELF)
    setActiveAthleteId(SELF)
    useAuthStore.setState({ activeAthleteId: SELF })
  })

  afterEach(() => {
    useCoachMemoryStore.setState({ loadMemory: originalLoadMemory })
    vi.restoreAllMocks()
    db.close()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    useAuthStore.setState({ activeAthleteId: null })
    useCoachMemoryStore.getState().resetForAthleteSwitch()
  })

  it('switches to a managed athlete, bumps epoch, resets stores and persists selection', async () => {
    await seedAthletes()
    await db.athleteProfiles.put({
      id: MANAGED,
      athleteId: MANAGED,
      updatedAt: 2,
      name: 'Cliente 1',
    })
    useCoachMemoryStore.setState({
      athleteProfile: { id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: 1, name: 'Rafa' },
      hasLoaded: true,
    })
    const epochBefore = getSwitchEpoch()

    const ok = await switchActiveAthlete(OWNER, MANAGED)

    expect(ok).toBe(true)
    expect(getSwitchEpoch()).toBe(epochBefore + 1)
    expect(useCoachMemoryStore.getState().athleteProfile?.name).toBe('Cliente 1')
    expect(useCoachMemoryStore.getState().hasLoaded).toBe(true)
    expect(getPersistedAthleteSelection(OWNER)).toBe(MANAGED)
    expect(getActiveAthleteId()).toBe(MANAGED)
    expect(useAuthStore.getState().activeAthleteId).toBe(MANAGED)
  })

  it('clears persisted selection when switching back to self', async () => {
    await seedAthletes()
    await switchActiveAthlete(OWNER, MANAGED)

    const ok = await switchActiveAthlete(OWNER, SELF)

    expect(ok).toBe(true)
    expect(getPersistedAthleteSelection(OWNER)).toBeNull()
    expect(getActiveAthleteId()).toBe(SELF)
    await vi.waitFor(() => expect(pullWorkouts).toHaveBeenCalledOnce())
    expect(autoCompleteFromWorkouts).toHaveBeenCalledOnce()
  })

  it('does not pull workouts when switching to a managed athlete', async () => {
    await seedAthletes()
    await switchActiveAthlete(OWNER, MANAGED)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pullWorkouts).not.toHaveBeenCalled()
    expect(autoCompleteFromWorkouts).not.toHaveBeenCalled()
  })

  it('does not match stale cache when the pull fails after switching to self', async () => {
    await seedAthletes()
    await switchActiveAthlete(OWNER, MANAGED)
    vi.mocked(pullWorkouts).mockRejectedValueOnce(new Error('offline'))
    await switchActiveAthlete(OWNER, SELF)
    await vi.waitFor(() => expect(pullWorkouts).toHaveBeenCalledOnce())
    expect(autoCompleteFromWorkouts).not.toHaveBeenCalled()
  })

  it('invalid, foreign-owner or inactive targets are no-ops', async () => {
    await seedAthletes()
    await db.athletes.bulkPut([
      {
        id: 'ath_m_off',
        ownerAccountId: OWNER,
        linkedAccountId: null,
        displayName: 'Baja',
        status: 'archived',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'ath_other',
        ownerAccountId: 'user-2',
        linkedAccountId: null,
        displayName: 'Otro',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    const epochBefore = getSwitchEpoch()

    expect(await switchActiveAthlete(OWNER, 'ath_m_missing')).toBe(false)
    expect(await switchActiveAthlete(OWNER, 'ath_m_off')).toBe(false)
    expect(await switchActiveAthlete(OWNER, 'ath_other')).toBe(false)
    expect(getSwitchEpoch()).toBe(epochBefore)
    expect(getActiveAthleteId()).toBe(SELF)
  })

  it('loadMemory falla DESPUES del commit: el switch sigue siendo exitoso', async () => {
    await seedAthletes()
    useCoachMemoryStore.setState({
      loadMemory: vi.fn(async () => { throw new Error('memoria caída') }),
    })

    await expect(switchActiveAthlete(OWNER, MANAGED)).resolves.toBe(true)

    // El scope YA cambió antes de loadMemory(): devolver false seria mentirle a la UI.
    expect(getActiveAthleteId()).toBe(MANAGED)
    expect(useAuthStore.getState().activeAthleteId).toBe(MANAGED)
    expect(getPersistedAthleteSelection(OWNER)).toBe(MANAGED)
  })

  it('Dexie falla ANTES del commit: propaga y no toca el scope', async () => {
    await seedAthletes()
    vi.spyOn(db.athletes, 'get').mockRejectedValueOnce(new Error('Dexie falló antes del commit'))
    const epochBefore = getSwitchEpoch()

    await expect(switchActiveAthlete(OWNER, MANAGED)).rejects.toThrow('Dexie falló antes del commit')

    // Pre-commit: no se aplicó nada, asi que propagar es lo correcto.
    expect(getSwitchEpoch()).toBe(epochBefore)
    expect(getActiveAthleteId()).toBe(SELF)
  })
  it('acepta un transferido: membresía coach sin ser propietario', async () => {
    const now = Date.now()
    await db.athletes.put({ id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'T', status: 'active', createdAt: now, updatedAt: now } as never)
    await db.athleteMemberships.bulkPut([
      { athleteId: SELF, accountId: OWNER, role: 'self', createdAt: now, updatedAt: now },
      { athleteId: 'ath_m_t', accountId: OWNER, role: 'coach', createdAt: now, updatedAt: now },
    ])

    expect(await switchActiveAthlete(OWNER, 'ath_m_t')).toBe(true)
    expect(getActiveAthleteId()).toBe('ath_m_t')
    expect(getPersistedAthleteSelection(OWNER)).toBe('ath_m_t')
  })

  it('rechaza un atleta propio cuya membresía fue revocada (caché hidratada)', async () => {
    const now = Date.now()
    await markMembershipsHydrated(OWNER)
    await db.athleteMemberships.put({ athleteId: SELF, accountId: OWNER, role: 'self', createdAt: now, updatedAt: now })
    setActiveAthleteId(SELF)

    expect(await switchActiveAthlete(OWNER, MANAGED)).toBe(false)
    expect(getActiveAthleteId()).toBe(SELF)
  })

  it('clearActiveAthleteSelection deja la cuenta sin atleta y limpia la selección persistida', async () => {
    await seedAthletes()
    expect(await switchActiveAthlete(OWNER, MANAGED)).toBe(true)
    const epochBefore = getSwitchEpoch()

    await clearActiveAthleteSelection(OWNER)

    expect(getActiveAthleteId()).toBeNull()
    expect(useAuthStore.getState().activeAthleteId).toBeNull()
    expect(getPersistedAthleteSelection(OWNER)).toBeNull()
    expect(getSwitchEpoch()).toBe(epochBefore + 1)
  })

})
