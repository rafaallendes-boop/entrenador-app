import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SupabaseResult = { data: unknown; error: unknown }

const localStorageState = new Map<string, string>()
const syncStatusMock = vi.fn()
const syncDetailsMock = vi.fn()

let sessionsRows: unknown[] = []
let dayLogRows: unknown[] = []
let weekSummaryRows: unknown[] = []
let chatMessageRows: unknown[] = []
let coachProposalRows: unknown[] = []
let athleteProfileRows: unknown[] = []
let tableResults = new Map<string, SupabaseResult>()
const upsertCalls: Array<{ table: string; payload: unknown }> = []

function createDeleteBuilder(table: string) {
  return {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    then(onFulfilled: (value: SupabaseResult) => unknown) {
      return Promise.resolve(onFulfilled(tableResults.get(table) ?? { data: null, error: null }))
    },
  }
}

vi.mock('../auth', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: vi.fn((payload: unknown) => {
        upsertCalls.push({ table, payload })
        return Promise.resolve(tableResults.get(table) ?? { data: null, error: null })
      }),
      insert: vi.fn(() => Promise.resolve(tableResults.get(table) ?? { data: null, error: null })),
      update: vi.fn(() => createDeleteBuilder(table)),
      select: vi.fn(() => createDeleteBuilder(table)),
      delete: vi.fn(() => createDeleteBuilder(table)),
    }),
  },
}))

vi.mock('../appMaintenance', () => ({
  clearAllLocalAppData: vi.fn(async () => {}),
}))

vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: {
    getState: () => ({
      user: { id: 'user-1' },
      setSyncStatus: syncStatusMock,
      setSyncDetails: syncDetailsMock,
    }),
  },
}))

vi.mock('../../db/db', () => ({
  db: {
    sessions: {
      toArray: vi.fn(async () => sessionsRows),
      count: vi.fn(async () => sessionsRows.length),
    },
    dayLogs: {
      toArray: vi.fn(async () => dayLogRows),
      count: vi.fn(async () => dayLogRows.length),
    },
    weekSummaries: {
      toArray: vi.fn(async () => weekSummaryRows),
      count: vi.fn(async () => weekSummaryRows.length),
    },
    chatMessages: {
      toArray: vi.fn(async () => chatMessageRows),
      count: vi.fn(async () => chatMessageRows.length),
    },
    coachProposals: {
      toArray: vi.fn(async () => coachProposalRows),
      count: vi.fn(async () => coachProposalRows.length),
    },
    athleteProfiles: {
      toArray: vi.fn(async () => athleteProfileRows),
      count: vi.fn(async () => athleteProfileRows.length),
    },
  },
}))

describe('syncService', () => {
  beforeEach(() => {
    sessionsRows = []
    dayLogRows = []
    weekSummaryRows = []
    chatMessageRows = []
    coachProposalRows = []
    athleteProfileRows = []
    tableResults = new Map()
    upsertCalls.length = 0
    localStorageState.clear()
    syncStatusMock.mockReset()
    syncDetailsMock.mockReset()

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => localStorageState.get(key) ?? null,
        setItem: (key: string, value: string) => {
          localStorageState.set(key, value)
        },
        removeItem: (key: string) => {
          localStorageState.delete(key)
        },
      },
    })

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    })
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('does not mark migration as complete when any table upsert fails', async () => {
    sessionsRows = [{
      id: 'session-1',
      date: '2026-04-11',
      weekStartDate: '2026-04-06',
      timeBlock: 'AM',
      type: 'running',
      status: 'planned',
      title: 'Tempo',
      durationMin: 45,
      createdAt: 1,
      updatedAt: 2,
    }]
    weekSummaryRows = [{
      id: 'week-1',
      weekStartDate: '2026-04-06',
      updatedAt: 777,
      totalSessions: 1,
      totalMinutes: 45,
      plannedSessions: 1,
      completedSessions: 0,
      plannedMinutes: 45,
      completedMinutes: 0,
      squashSessions: 0,
      runningSessions: 1,
      strengthSessions: 0,
    }]
    tableResults.set('sessions', { data: null, error: { message: 'jwt expired', status: 401 } })
    tableResults.set('week_summaries', { data: null, error: null })

    const syncService = await import('../syncService')

    await expect(syncService.migrateLocalDataToCloud('user-1')).rejects.toThrow('Migration partial failure')
    expect(localStorage.getItem('entrenador_migrated_v1:user-1')).toBeNull()
  })

  it('marks migration complete only after all table writes succeed and preserves week summary updatedAt', async () => {
    weekSummaryRows = [{
      id: 'week-1',
      weekStartDate: '2026-04-06',
      updatedAt: 777,
      totalSessions: 1,
      totalMinutes: 45,
      plannedSessions: 1,
      completedSessions: 0,
      plannedMinutes: 45,
      completedMinutes: 0,
      squashSessions: 0,
      runningSessions: 1,
      strengthSessions: 0,
    }]

    const syncService = await import('../syncService')

    await syncService.migrateLocalDataToCloud('user-1')

    expect(localStorage.getItem('entrenador_migrated_v1:user-1')).toBe('1')
    const weekSummaryUpsert = upsertCalls.find((call) => call.table === 'week_summaries')
    expect(weekSummaryUpsert).toBeTruthy()
    expect((weekSummaryUpsert?.payload as Array<Record<string, unknown>>)[0]?.updated_at).toBe(777)
  })

  it('re-enqueues writes on retryable 401 auth errors instead of treating them as infrastructure', async () => {
    tableResults.set('sessions', { data: null, error: { message: 'JWT expired', status: 401 } })
    const syncService = await import('../syncService')

    await syncService.pushSession({
      id: 'session-1',
      date: '2026-04-11',
      weekStartDate: '2026-04-06',
      timeBlock: 'AM',
      type: 'running',
      status: 'planned',
      title: 'Tempo',
      durationMin: 45,
      createdAt: 1,
      updatedAt: 2,
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    const queue = JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]') as Array<{ table: string }>
    expect(queue).toHaveLength(1)
    expect(queue[0]?.table).toBe('sessions')
  })
})
