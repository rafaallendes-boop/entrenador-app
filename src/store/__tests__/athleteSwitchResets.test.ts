import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/syncService', () => ({
  pushCoachProposal: vi.fn(async () => {}),
  pushSession: vi.fn(async () => {}),
  pushDayLog: vi.fn(async () => {}),
  pushWeekSummary: vi.fn(async () => {}),
  pushChatMessage: vi.fn(async () => {}),
  pushAthleteProfile: vi.fn(async () => {}),
  pushTrainingPlan: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  deleteWeekSummaries: vi.fn(async () => {}),
  deleteChatMessages: vi.fn(async () => {}),
  deleteCoachProposals: vi.fn(async () => {}),
  canWriteAthleteProfileLocally: vi.fn(() => true),
}))

import { db } from '../../db/db'
import { ATHLETE_PROFILE_LOCAL_ID, setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import type { WeekSummary } from '../../types'
import { useChatStore } from '../useChatStore'
import { useCoachActionsStore } from '../useCoachActionsStore'
import { useCoachMemoryStore } from '../useCoachMemoryStore'
import { usePlanBuilderStore } from '../usePlanBuilderStore'
import { useTrainingStore } from '../useTrainingStore'

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

function makeWeekSummary(overrides: Partial<WeekSummary> & Pick<WeekSummary, 'id' | 'weekStartDate'>): WeekSummary {
  return {
    totalSessions: 0,
    totalMinutes: 0,
    plannedSessions: 0,
    completedSessions: 0,
    plannedMinutes: 0,
    completedMinutes: 0,
    squashSessions: 0,
    runningSessions: 0,
    strengthSessions: 0,
    ...overrides,
  }
}

describe('resetForAthleteSwitch', () => {
  beforeEach(async () => {
    installLocalStorage()
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
    localStorage.clear()
  })

  afterEach(() => {
    db.close()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('useCoachMemoryStore: reset clears cached profile and discards a late loadMemory', async () => {
    await db.athleteProfiles.put({ id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: 1, name: 'Atleta Anterior' })
    const memory = useCoachMemoryStore.getState()

    const load = memory.loadMemory()
    memory.resetForAthleteSwitch()
    await load

    expect(useCoachMemoryStore.getState().athleteProfile).toBeNull()
    expect(useCoachMemoryStore.getState().hasLoaded).toBe(false)
  })

  it('useCoachMemoryStore: reset discards a late saveAthleteProfile', async () => {
    const memory = useCoachMemoryStore.getState()

    const save = memory.saveAthleteProfile({ name: 'Atleta Anterior' })
    memory.resetForAthleteSwitch()
    await save

    expect(useCoachMemoryStore.getState().athleteProfile).toBeNull()
    expect(useCoachMemoryStore.getState().hasLoaded).toBe(false)
  })

  it('useCoachActionsStore: reset discards a late loadProposals', async () => {
    await db.coachProposals.put({
      id: 'p1',
      createdAt: 1,
      status: 'pending',
      message: 'm',
      actions: [],
      athleteId: 'ath_user-1',
    })
    const actions = useCoachActionsStore.getState()

    const load = actions.loadProposals()
    actions.resetForAthleteSwitch()
    await load

    expect(useCoachActionsStore.getState().proposals).toEqual([])
  })

  it('useTrainingStore: reset discards a late loadAllSummaries', async () => {
    await db.weekSummaries.put(makeWeekSummary({ id: 'w1', weekStartDate: '2026-06-29', athleteId: 'ath_user-1' }))
    const training = useTrainingStore.getState()

    const load = training.loadAllSummaries()
    training.resetForAthleteSwitch()
    await load

    expect(useTrainingStore.getState().allWeekSummaries).toEqual([])
  })

  it('useChatStore: reset discards a late loadHistory', async () => {
    useChatStore.setState({ messages: [{ id: 'seed' } as never] })
    const chat = useChatStore.getState()

    const load = chat.loadHistory()
    chat.resetForAthleteSwitch()
    await load

    expect(useChatStore.getState().messages).toEqual([])
  })

  it('usePlanBuilderStore: reset returns to idle state', () => {
    usePlanBuilderStore.setState({ status: 'generating', lastError: 'x', completedWeeks: 3 })

    usePlanBuilderStore.getState().resetForAthleteSwitch()

    const state = usePlanBuilderStore.getState()
    expect(state.status).toBe('idle')
    expect(state.plan).toBeNull()
    expect(state.completedWeeks).toBe(0)
    expect(state.lastError).toBeNull()
  })
})
