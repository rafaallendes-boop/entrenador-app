import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SupabaseResult = { data: unknown; error: unknown }

const localStorageState = new Map<string, string>()
const syncStatusMock = vi.fn()
const syncDetailsMock = vi.fn()
function createSyncDetailsState() {
  return {
    pendingOps: 0,
    syncAttemptInFlight: false,
    pendingUpserts: 0,
    pendingDeletes: 0,
    oldestPendingOpAt: null,
    pendingTables: [],
    lastSyncAt: null,
    lastSuccessfulSyncAt: null,
    lastRecoveredSyncAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    lastErrorCategory: null,
    lastBlockedTable: null,
    retryScheduledAt: null,
    consecutiveFailures: 0,
    autoRepairInProgress: false,
    lastAutoRepairAt: null,
    memoryLoadRequiredAfterSyncAt: null,
    memoryLoadedForSyncAt: null,
  }
}
const storeState = {
  user: { id: 'user-1' },
  syncDetails: createSyncDetailsState(),
  setSyncStatus: (...args: unknown[]) => syncStatusMock(...args),
  setSyncDetails: (patch: Record<string, unknown>) => {
    Object.assign(storeState.syncDetails, patch)
    syncDetailsMock(patch)
  },
}

let sessionsRows: unknown[] = []
let dayLogRows: unknown[] = []
let weekSummaryRows: unknown[] = []
let trainingPlanRows: unknown[] = []
let trainingPlanWeekRows: unknown[] = []
let chatMessageRows: unknown[] = []
let coachProposalRows: unknown[] = []
let athleteProfileRows: unknown[] = []
let tableResults = new Map<string, SupabaseResult>()
const upsertCalls: Array<{ table: string; payload: unknown }> = []
const deleteCalls: Array<{ table: string; filters: Array<{ op: 'eq' | 'in'; column: string; value: unknown }> }> = []
const updateCalls: Array<{ table: string; payload: unknown; filters: Array<{ op: 'eq' | 'in'; column: string; value: unknown }> }> = []
const selectCalls: Array<{ table: string; filters: Array<{ op: 'eq' | 'in'; column: string; value: unknown }> }> = []

function createQueryBuilder(
  table: string,
  action: 'delete' | 'update' | 'select',
  payload?: unknown,
) {
  const filters: Array<{ op: 'eq' | 'in'; column: string; value: unknown }> = []
  return {
    eq(column: string, value: unknown) {
      filters.push({ op: 'eq', column, value })
      return this
    },
    in(column: string, value: unknown) {
      filters.push({ op: 'in', column, value })
      return this
    },
    then(onFulfilled: (value: SupabaseResult) => unknown) {
      if (action === 'delete') {
        deleteCalls.push({ table, filters: [...filters] })
      } else if (action === 'update') {
        updateCalls.push({ table, payload, filters: [...filters] })
      } else if (action === 'select') {
        selectCalls.push({ table, filters: [...filters] })
      }
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
      update: vi.fn((payload: unknown) => createQueryBuilder(table, 'update', payload)),
      select: vi.fn(() => createQueryBuilder(table, 'select')),
      delete: vi.fn(() => createQueryBuilder(table, 'delete')),
    }),
  },
}))

vi.mock('../appMaintenance', () => ({
  clearAllLocalAppData: vi.fn(async () => {}),
}))

vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: {
    getState: () => storeState,
  },
}))

vi.mock('../../db/db', () => ({
  db: {
    sessions: {
      toArray: vi.fn(async () => sessionsRows),
      count: vi.fn(async () => sessionsRows.length),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      bulkDelete: vi.fn(async () => {}),
    },
    dayLogs: {
      toArray: vi.fn(async () => dayLogRows),
      count: vi.fn(async () => dayLogRows.length),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      bulkDelete: vi.fn(async () => {}),
      where: vi.fn(() => ({ equals: vi.fn(async () => undefined) })),
    },
    weekSummaries: {
      toArray: vi.fn(async () => weekSummaryRows),
      count: vi.fn(async () => weekSummaryRows.length),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      bulkDelete: vi.fn(async () => {}),
      where: vi.fn(() => ({ equals: vi.fn(async () => undefined) })),
    },
    trainingPlans: {
      toArray: vi.fn(async () => trainingPlanRows),
      count: vi.fn(async () => trainingPlanRows.length),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      bulkDelete: vi.fn(async () => {}),
    },
    trainingPlanWeeks: {
      toArray: vi.fn(async () => trainingPlanWeekRows),
      count: vi.fn(async () => trainingPlanWeekRows.length),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      bulkDelete: vi.fn(async () => {}),
      where: vi.fn(() => ({ equals: vi.fn(() => ({ delete: vi.fn(async () => {}), toArray: vi.fn(async () => []) })) })),
    },
    chatMessages: {
      toArray: vi.fn(async () => chatMessageRows),
      count: vi.fn(async () => chatMessageRows.length),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      bulkDelete: vi.fn(async () => {}),
    },
    coachProposals: {
      toArray: vi.fn(async () => coachProposalRows),
      count: vi.fn(async () => coachProposalRows.length),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      bulkDelete: vi.fn(async () => {}),
    },
    athleteProfiles: {
      toArray: vi.fn(async () => athleteProfileRows),
      count: vi.fn(async () => athleteProfileRows.length),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    },
  },
}))

describe('syncService', () => {
  beforeEach(() => {
    sessionsRows = []
    dayLogRows = []
    weekSummaryRows = []
    trainingPlanRows = []
    trainingPlanWeekRows = []
    chatMessageRows = []
    coachProposalRows = []
    athleteProfileRows = []
    tableResults = new Map()
    upsertCalls.length = 0
    deleteCalls.length = 0
    updateCalls.length = 0
    selectCalls.length = 0
    localStorageState.clear()
    syncStatusMock.mockReset()
    syncDetailsMock.mockReset()
    storeState.user = { id: 'user-1' }
    storeState.syncDetails = createSyncDetailsState()

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

  it('migrates only active or archived plans and their weeks', async () => {
    trainingPlanRows = [
      {
        id: 'plan-active',
        athleteId: 'athlete-1',
        goalEventId: 'evt-1',
        status: 'active',
        title: 'Plan activo',
        startDate: '2026-04-14',
        endDate: '2026-04-20',
        totalWeeks: 1,
        phases: [],
        wizardConfig: {},
        macroSnapshot: {},
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'plan-draft',
        athleteId: 'athlete-1',
        goalEventId: 'evt-2',
        status: 'draft',
        title: 'Plan draft',
        startDate: '2026-04-21',
        endDate: '2026-04-27',
        totalWeeks: 1,
        phases: [],
        wizardConfig: {},
        macroSnapshot: {},
        createdAt: 1,
        updatedAt: 2,
      },
    ]
    trainingPlanWeekRows = [
      {
        id: 'week-active',
        planId: 'plan-active',
        weekIndex: 0,
        weekStartDate: '2026-04-14',
        phase: 'build',
        status: 'accepted',
        sessions: [],
        weekObjectives: [],
        targetLoadBySport: {},
        validationIssues: [],
        generationMeta: { attempts: 1 },
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'week-draft',
        planId: 'plan-draft',
        weekIndex: 0,
        weekStartDate: '2026-04-21',
        phase: 'build',
        status: 'draft',
        sessions: [],
        weekObjectives: [],
        targetLoadBySport: {},
        validationIssues: [],
        generationMeta: { attempts: 1 },
        createdAt: 1,
        updatedAt: 2,
      },
    ]

    const syncService = await import('../syncService')
    await syncService.migrateLocalDataToCloud('user-1')

    const planUpsert = upsertCalls.find((call) => call.table === 'training_plans')
    const weekUpsert = upsertCalls.find((call) => call.table === 'training_plan_weeks')
    expect(planUpsert).toBeTruthy()
    expect((planUpsert?.payload as Array<Record<string, unknown>>)).toHaveLength(1)
    expect((planUpsert?.payload as Array<Record<string, unknown>>)[0]?.id).toBe('plan-active')
    expect(weekUpsert).toBeTruthy()
    expect((weekUpsert?.payload as Array<Record<string, unknown>>)).toHaveLength(1)
    expect((weekUpsert?.payload as Array<Record<string, unknown>>)[0]?.id).toBe('week-active')
    expect(upsertCalls.findIndex((call) => call.table === 'training_plans')).toBeLessThan(
      upsertCalls.findIndex((call) => call.table === 'training_plan_weeks'),
    )
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

    const queue = JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]') as Array<{ table: string }>
    expect(queue).toHaveLength(1)
    expect(queue[0]?.table).toBe('sessions')
  })

  it('runFullSync drains a retryable queued op and clears diagnostics when the backend recovers', async () => {
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

    tableResults.set('sessions', { data: null, error: null })
    await syncService.runFullSync('user-1')

    const queue = JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]') as Array<{ table: string }>
    expect(queue).toHaveLength(0)
    expect(syncStatusMock).toHaveBeenCalledWith('idle')
    expect(syncDetailsMock).toHaveBeenCalledWith(expect.objectContaining({
      lastErrorMessage: null,
      lastBlockedTable: null,
      consecutiveFailures: 0,
    }))
  })

  it('clears remote data in dependency-safe order and wipes athlete profile by blanking it', async () => {
    athleteProfileRows = [{
      id: 'profile-1',
      user_id: 'user-1',
      coach_memory: 'memo',
      updated_at: 10,
      data: { name: 'Rafa', primarySport: 'squash' },
    }]
    tableResults.set('athlete_profiles', { data: athleteProfileRows, error: null })

    const syncService = await import('../syncService')
    await syncService.clearSelectedRemoteAppData('user-1', {
      trainingData: true,
      chatHistory: true,
      coachProposals: true,
      coachMemory: true,
    })

    expect(deleteCalls.map((call) => call.table)).toEqual([
      'training_plan_weeks',
      'training_plans',
      'sessions',
      'day_logs',
      'week_summaries',
      'coach_proposals',
      'chat_messages',
    ])

    const athleteProfileUpdate = updateCalls.find((call) => call.table === 'athlete_profiles')
    expect(athleteProfileUpdate).toBeTruthy()
    expect(athleteProfileUpdate?.filters).toEqual([
      { op: 'eq', column: 'id', value: 'profile-1' },
      { op: 'eq', column: 'user_id', value: 'user-1' },
    ])
  })

  it('wipes all remote tables and clears athlete profile via update instead of delete', async () => {
    athleteProfileRows = [{
      id: 'profile-1',
      user_id: 'user-1',
      coach_memory: 'memo',
      updated_at: 10,
      data: { name: 'Rafa' },
    }]
    tableResults.set('athlete_profiles', { data: athleteProfileRows, error: null })

    const syncService = await import('../syncService')
    await syncService.wipeRemoteAndLocalAppData('user-1')

    expect(deleteCalls.map((call) => call.table)).toEqual([
      'training_plan_weeks',
      'training_plans',
      'coach_proposals',
      'chat_messages',
      'week_summaries',
      'day_logs',
      'sessions',
    ])
    expect(deleteCalls.some((call) => call.table === 'athlete_profiles')).toBe(false)
    expect(updateCalls.some((call) => call.table === 'athlete_profiles')).toBe(true)
  })

  it('surfaces expired queue ops instead of reporting a healthy recovery', async () => {
    localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([
      {
        userId: 'user-1',
        table: 'sessions',
        action: 'upsert',
        payload: { id: 'session-expired' },
        enqueuedAt: 1,
        retryCount: 5,
        lastErrorCategory: 'network_error',
      },
    ]))

    const syncService = await import('../syncService')
    const drained = await syncService.drainQueue()

    expect(drained).toBe(false)
    expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    expect(syncStatusMock).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('Se descart'),
    )
    expect(syncDetailsMock).toHaveBeenCalledWith(expect.objectContaining({
      lastErrorCategory: 'network_error',
      lastBlockedTable: 'sessions',
    }))
  })
})
