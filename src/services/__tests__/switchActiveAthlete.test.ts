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

import { db } from '../../db/db'
import {
  ATHLETE_PROFILE_LOCAL_ID,
  getActiveAthleteId,
  getSwitchEpoch,
  setActiveAthleteId,
  setSelfAthleteId,
} from '../athlete/activeAthlete'
import { getPersistedAthleteSelection } from '../athlete/athleteSelection'
import { switchActiveAthlete } from '../athlete/switchActiveAthlete'
import { useAuthStore } from '../../store/useAuthStore'
import { useCoachMemoryStore } from '../../store/useCoachMemoryStore'

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
  beforeEach(async () => {
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
})
