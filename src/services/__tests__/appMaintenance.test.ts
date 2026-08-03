import { beforeEach, describe, expect, it, vi } from 'vitest'

const localStorageState = new Map<string, string>()
const setChatStateMock = vi.fn()
const setCoachActionsStateMock = vi.fn()
const setCoachMemoryStateMock = vi.fn()
const setPlanBuilderStateMock = vi.fn()
const setTrainingStateMock = vi.fn()

const table = () => ({
  clear: vi.fn(async () => {}),
})

const dbMock = {
  sessions: table(),
  dayLogs: table(),
  readinessDaily: table(),
  whoopWorkouts: table(),
  weekSummaries: table(),
  trainingPlans: table(),
  trainingPlanWeeks: table(),
  planGenerationJobs: table(),
  chatMessages: table(),
  coachProposals: table(),
  athleteProfiles: table(),
  athletes: table(),
  athleteMemberships: table(),
  athleteCoachNotes: table(),
  sessionTemplates: table(),
  consentAcceptances: table(),
  transaction: vi.fn(async (_mode: string, _tables: unknown[], callback: () => Promise<void>) => {
    await callback()
  }),
}

vi.mock('../../db/db', () => ({
  db: dbMock,
}))

vi.mock('../../store/useChatStore', () => ({
  useChatStore: {
    setState: (...args: unknown[]) => setChatStateMock(...args),
  },
}))

vi.mock('../../store/useCoachActionsStore', () => ({
  useCoachActionsStore: {
    setState: (...args: unknown[]) => setCoachActionsStateMock(...args),
  },
}))

vi.mock('../../store/useCoachMemoryStore', () => ({
  useCoachMemoryStore: {
    setState: (...args: unknown[]) => setCoachMemoryStateMock(...args),
  },
}))

vi.mock('../../store/usePlanBuilderStore', () => ({
  usePlanBuilderStore: {
    setState: (...args: unknown[]) => setPlanBuilderStateMock(...args),
  },
}))

vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: {
    setState: (...args: unknown[]) => setTrainingStateMock(...args),
  },
}))

vi.mock('../../utils/chatSession', () => ({
  clearStoredChatSessionId: vi.fn(() => {
    localStorage.removeItem('coach_chat_session_id')
  }),
  clearAllStoredChatSessionIds: vi.fn(() => {
    // Mirrors the real account-global cleanup: every legacy/scoped session key.
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('coach_chat_session_id') || key.startsWith('coach_chat_session_local_only')) {
        localStorage.removeItem(key)
      }
    }
  }),
  getOrCreateChatSessionId: vi.fn(() => {
    localStorage.setItem('coach_chat_session_id', 'next-session')
    return 'next-session'
  }),
}))

describe('appMaintenance', () => {
  beforeEach(() => {
    localStorageState.clear()
    vi.clearAllMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          get length() {
            return localStorageState.size
          },
          key: (index: number) => Array.from(localStorageState.keys())[index] ?? null,
          getItem: (key: string) => localStorageState.get(key) ?? null,
          setItem: (key: string, value: string) => {
            localStorageState.set(key, value)
          },
          removeItem: (key: string) => {
            localStorageState.delete(key)
          },
          clear: () => {
            localStorageState.clear()
          },
        },
      },
    })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: window.localStorage,
    })
  })

  it('clears exact reset-related localStorage keys', async () => {
    const { clearAllAppLocalStorage } = await import('../appMaintenance')
    localStorage.setItem('coach_chat_session_id', 'session-1')
    localStorage.setItem('entrenador_notification_preferences_v1', '{}')
    localStorage.setItem('scheduled_session_notifications_v1', '{}')
    localStorage.setItem('entrenador_remote_reset_ack_v1:user-1', '500')
    localStorage.setItem('entrenador_sync_user_v1', 'user-1')
    localStorage.setItem('unrelated_key', 'keep')

    clearAllAppLocalStorage('user-1')

    expect(localStorage.getItem('coach_chat_session_id')).toBeNull()
    expect(localStorage.getItem('entrenador_notification_preferences_v1')).toBeNull()
    expect(localStorage.getItem('scheduled_session_notifications_v1')).toBeNull()
    expect(localStorage.getItem('entrenador_remote_reset_ack_v1:user-1')).toBeNull()
    expect(localStorage.getItem('entrenador_sync_user_v1')).toBeNull()
    expect(localStorage.getItem('unrelated_key')).toBe('keep')
  })

  it('sweeps app-owned prefixes and keeps unrelated keys', async () => {
    const { clearAllAppLocalStorage } = await import('../appMaintenance')
    localStorage.setItem('entrenador_sync_queue_v1', '[]')
    localStorage.setItem('entrenador:onboarding:skipped:user-1', '1')
    localStorage.setItem('coach_custom_flag', '1')
    localStorage.setItem('third_party_cache', 'keep')

    clearAllAppLocalStorage()

    expect(localStorage.getItem('entrenador_sync_queue_v1')).toBeNull()
    expect(localStorage.getItem('entrenador:onboarding:skipped:user-1')).toBeNull()
    expect(localStorage.getItem('coach_custom_flag')).toBeNull()
    expect(localStorage.getItem('third_party_cache')).toBe('keep')
  })

  it('clears the durable athlete tombstone and its in-memory mirror', async () => {
    const { clearAllAppLocalStorage } = await import('../appMaintenance')
    const {
      hasAthleteDeleteTombstone,
      rememberAthleteDeleteTombstone,
    } = await import('../sync/athleteDeleteTombstones')

    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)

    clearAllAppLocalStorage('user-1')

    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(false)
  })

  it('clears indexed app data and leaves no app-owned localStorage residue', async () => {
    const { clearAllLocalAppData } = await import('../appMaintenance')
    localStorage.setItem('coach_chat_session_id', 'session-1')
    localStorage.setItem('entrenador_sync_queue_v1', '[]')
    localStorage.setItem('entrenador_remote_reset_ack_v1:user-1', '500')
    localStorage.setItem('unrelated_key', 'keep')

    await clearAllLocalAppData('user-1')

    expect(dbMock.transaction).toHaveBeenCalled()
    expect(dbMock.sessions.clear).toHaveBeenCalled()
    expect(dbMock.dayLogs.clear).toHaveBeenCalled()
    expect(dbMock.weekSummaries.clear).toHaveBeenCalled()
    expect(dbMock.trainingPlanWeeks.clear).toHaveBeenCalled()
    expect(dbMock.trainingPlans.clear).toHaveBeenCalled()
    expect(dbMock.planGenerationJobs.clear).toHaveBeenCalled()
    expect(dbMock.athletes.clear).toHaveBeenCalled()
    expect(dbMock.chatMessages.clear).toHaveBeenCalled()
    expect(dbMock.coachProposals.clear).toHaveBeenCalled()
    expect(dbMock.athleteProfiles.clear).toHaveBeenCalled()
    expect(dbMock.sessionTemplates.clear).toHaveBeenCalled()
    expect(dbMock.consentAcceptances.clear).toHaveBeenCalled()
    expect(Array.from(localStorageState.keys()).filter((key) => (
      key.startsWith('entrenador_') || key.startsWith('coach_') || key.startsWith('entrenador:')
    ))).toEqual([])
    expect(localStorage.getItem('unrelated_key')).toBe('keep')
  })

  it('clears athletes when clearing selected local training data', async () => {
    const { clearSelectedLocalAppData } = await import('../appMaintenance')

    await clearSelectedLocalAppData({ trainingData: true })

    expect(dbMock.transaction).toHaveBeenCalledWith(
      'rw',
      expect.arrayContaining([dbMock.athletes]),
      expect.any(Function),
    )
    expect(dbMock.sessions.clear).toHaveBeenCalled()
    expect(dbMock.athletes.clear).toHaveBeenCalled()
    expect(dbMock.chatMessages.clear).not.toHaveBeenCalled()
    expect(dbMock.coachProposals.clear).not.toHaveBeenCalled()
    expect(dbMock.athleteProfiles.clear).not.toHaveBeenCalled()
    expect(dbMock.sessionTemplates.clear).not.toHaveBeenCalled()
    expect(dbMock.consentAcceptances.clear).not.toHaveBeenCalled()
  })
})
