import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SupabaseResult = { data: unknown; error: unknown }

const localStorageState = new Map<string, string>()
const syncStatusMock = vi.fn()
const syncDetailsMock = vi.fn()
const clearAllLocalAppDataMock = vi.fn(async () => {
  sessionsRows = []
  dayLogRows = []
  weekSummaryRows = []
  trainingPlanRows = []
  trainingPlanWeekRows = []
  chatMessageRows = []
  coachProposalRows = []
  athleteProfileRows = []
})
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
    awaitingProfileRecreationAfterReset: false,
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
let actionResults = new Map<string, SupabaseResult>()
const upsertCalls: Array<{ table: string; payload: unknown; options?: unknown }> = []
const insertCalls: Array<{ table: string; payload: unknown }> = []
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
      return Promise.resolve(onFulfilled(getSupabaseResult(table, action)))
    },
  }
}

function getSupabaseResult(table: string, action: 'delete' | 'update' | 'select' | 'upsert' | 'insert'): SupabaseResult {
  return actionResults.get(`${action}:${table}`) ?? tableResults.get(table) ?? { data: null, error: null }
}

function createSupabaseFrom() {
  return (table: string) => ({
    upsert: vi.fn((payload: unknown, options?: unknown) => {
      upsertCalls.push({ table, payload, options })
      return Promise.resolve(getSupabaseResult(table, 'upsert'))
    }),
    insert: vi.fn((payload: unknown) => {
      insertCalls.push({ table, payload })
      return Promise.resolve(getSupabaseResult(table, 'insert'))
    }),
    update: vi.fn((payload: unknown) => createQueryBuilder(table, 'update', payload)),
    select: vi.fn(() => createQueryBuilder(table, 'select')),
    delete: vi.fn(() => createQueryBuilder(table, 'delete')),
  })
}

const supabaseMock = {
  from: createSupabaseFrom(),
}

function requireMockSupabase(auth: Awaited<typeof import('../auth')>) {
  if (!auth.supabase) {
    throw new Error('Expected mocked supabase client to be available in syncService tests')
  }
  return auth.supabase
}

vi.mock('../auth', () => ({
  supabase: supabaseMock,
}))

vi.mock('../appMaintenance', () => ({
  clearAllLocalAppData: clearAllLocalAppDataMock,
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
    actionResults = new Map()
    upsertCalls.length = 0
    insertCalls.length = 0
    deleteCalls.length = 0
    updateCalls.length = 0
    selectCalls.length = 0
    localStorageState.clear()
    syncStatusMock.mockReset()
    syncDetailsMock.mockReset()
    clearAllLocalAppDataMock.mockReset()
    supabaseMock.from = createSupabaseFrom()
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
    expect(weekSummaryUpsert?.options).toEqual({ onConflict: 'user_id,week_start_date' })
  })

  it('uses logical unique keys for migration upserts that can collide across devices', async () => {
    dayLogRows = [{
      id: 'local-day-log',
      date: '2026-04-06',
      updatedAt: 10,
      sleepHours: 7,
    }]
    weekSummaryRows = [{
      id: 'local-week-summary',
      weekStartDate: '2026-04-06',
      updatedAt: 20,
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
    chatMessageRows = [{
      id: 'chat-1',
      role: 'user',
      content: 'hola',
      timestamp: 1,
      chatSessionId: 'thread-1',
    }]

    const syncService = await import('../syncService')

    await syncService.migrateLocalDataToCloud('user-1')

    expect(upsertCalls.find((call) => call.table === 'day_logs')?.options).toEqual({ onConflict: 'user_id,date' })
    expect(upsertCalls.find((call) => call.table === 'week_summaries')?.options).toEqual({ onConflict: 'user_id,week_start_date' })
    expect(upsertCalls.find((call) => call.table === 'chat_messages')?.options).toBeUndefined()
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
    const outcome = await syncService.clearSelectedRemoteAppData('user-1', {
      trainingData: true,
      chatHistory: true,
      coachProposals: true,
      coachMemory: true,
    })

    expect(deleteCalls.map((call) => call.table)).toEqual([
      'training_plan_weeks',
      'training_plans',
      'coach_proposals',
      'chat_messages',
      'week_summaries',
      'day_logs',
      'sessions',
    ])

    const athleteProfileUpdate = updateCalls.find((call) => call.table === 'athlete_profiles')
    expect(athleteProfileUpdate).toBeTruthy()
    expect(athleteProfileUpdate?.filters).toEqual([
      { op: 'eq', column: 'id', value: 'profile-1' },
      { op: 'eq', column: 'user_id', value: 'user-1' },
    ])
    expect(outcome.completed).toBe(true)
    expect(outcome.pending).toEqual([])
  })

  it('wipes all remote tables and hard deletes athlete profile rows during a full reset', async () => {
    athleteProfileRows = [{
      id: 'profile-1',
      user_id: 'user-1',
      coach_memory: 'memo',
      updated_at: 10,
      data: { name: 'Rafa' },
    }]
    tableResults.set('athlete_profiles', { data: athleteProfileRows, error: null })

    const syncService = await import('../syncService')
    const outcome = await syncService.wipeRemoteAndLocalAppData('user-1')

    expect(deleteCalls.map((call) => call.table)).toEqual([
      'training_plan_weeks',
      'training_plans',
      'coach_proposals',
      'chat_messages',
      'week_summaries',
      'day_logs',
      'sessions',
      'athlete_profiles',
    ])
    expect(updateCalls.some((call) => call.table === 'athlete_profiles')).toBe(false)
    expect(upsertCalls.some((call) => call.table === 'athlete_profiles')).toBe(true)
    expect(insertCalls.some((call) => call.table === 'athlete_profiles')).toBe(false)
    expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    expect(localStorage.getItem('entrenador_profile_reset_lock_v1')).toContain('awaiting_bootstrap_ack')
    expect(outcome.completed).toBe(true)
    expect(outcome.pending).toEqual([])
  })

  it('tolerates missing optional plan sync tables during a full reset', async () => {
    tableResults.set('training_plans', {
      data: null,
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.training_plans' in the schema cache",
      },
    })

    const syncService = await import('../syncService')
    const outcome = await syncService.wipeRemoteAndLocalAppData('user-1')

    expect(outcome.completed).toBe(true)
    expect(outcome.tolerated).toContain('training_plans')
    expect(outcome.pending).toEqual([])
    expect(clearAllLocalAppDataMock).toHaveBeenCalled()
  })

  it('does not block a full reset when the post-delete athlete profile marker cannot be written', async () => {
    actionResults.set('upsert:athlete_profiles', {
      data: null,
      error: {
        code: 'PGRST204',
        message: "Could not find the 'data' column of 'athlete_profiles' in the schema cache",
      },
    })
    actionResults.set('select:athlete_profiles', { data: [], error: null })

    const syncService = await import('../syncService')
    const outcome = await syncService.wipeRemoteAndLocalAppData('user-1')

    expect(deleteCalls.some((call) => call.table === 'athlete_profiles')).toBe(true)
    expect(upsertCalls.some((call) => call.table === 'athlete_profiles')).toBe(true)
    expect(outcome.completed).toBe(true)
    expect(outcome.pending).toEqual([])
    expect(clearAllLocalAppDataMock).toHaveBeenCalled()
  })

  it('clears stale local data before migration when a newer remote full reset marker exists', async () => {
    sessionsRows = [{
      id: 'session-1',
      user_id: 'user-1',
      updated_at: 100,
      date: '2026-04-13',
      week_start_date: '2026-04-13',
      time_block: 'AM',
      type: 'squash',
      source: 'manual',
      status: 'planned',
      title: 'Old local session',
      duration_min: 60,
      data: {},
    }]
    athleteProfileRows = [{
      id: 'default',
      user_id: 'user-1',
      coach_memory: null,
      updated_at: 500,
      data: {
        __fullResetAt: 500,
        __deletedFields: ['name', 'primarySport', 'planWizardConfig'],
        __clearCoachMemory: true,
      },
    }]
    tableResults.set('athlete_profiles', { data: athleteProfileRows, error: null })

    const syncService = await import('../syncService')
    const prepared = await syncService.prepareLocalDataForUser('user-1')

    expect(clearAllLocalAppDataMock).toHaveBeenCalled()
    expect(prepared.shouldMigrate).toBe(false)
    expect(localStorage.getItem('entrenador_remote_reset_ack_v1:user-1')).toBe('500')
  })

  it('keeps failed selective remote wipes pending for the next sync instead of dropping them', async () => {
    tableResults.set('sessions', { data: null, error: { message: 'Failed to fetch' } })

    const syncService = await import('../syncService')
    const outcome = await syncService.clearSelectedRemoteAppData('user-1', {
      trainingData: true,
    })

    expect(outcome.completed).toBe(false)
    expect(outcome.failed.map((entry) => entry.table)).toContain('sessions')
    expect(outcome.pending).toContain('sessions')
    expect(outcome.succeeded).toEqual(expect.arrayContaining([
      'training_plan_weeks',
      'training_plans',
      'day_logs',
      'week_summaries',
    ]))
    expect(localStorage.getItem('entrenador_remote_wipe_v1')).toContain('sessions')
  })

  it('does not clear local data on full reset until every remote table has been wiped', async () => {
    tableResults.set('day_logs', { data: null, error: { message: 'Failed to fetch' } })

    const syncService = await import('../syncService')
    const outcome = await syncService.wipeRemoteAndLocalAppData('user-1')

    expect(outcome.completed).toBe(false)
    expect(outcome.pending).toContain('day_logs')
    expect(clearAllLocalAppDataMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('entrenador_remote_wipe_v1')).toContain('day_logs')
  })

  it('skips pulling tables whose remote wipe is still pending so data cannot resurrect locally', async () => {
    localStorageState.set('entrenador_remote_wipe_v1', JSON.stringify({
      'user-1': {
        tables: ['sessions'],
        requestedAt: Date.now(),
      },
    }))
    tableResults.set('sessions', { data: null, error: { message: 'Failed to fetch' } })

    const syncService = await import('../syncService')
    await syncService.runFullSync('user-1')

    expect(selectCalls.some((call) => call.table === 'sessions')).toBe(false)
  })

  it('does not mark the initial remote pull complete while athlete_profiles cleanup is still pending', async () => {
    localStorageState.set('entrenador_remote_wipe_v1', JSON.stringify({
      'user-1': {
        tables: ['athlete_profiles'],
        requestedAt: Date.now(),
      },
    }))
    tableResults.set('athlete_profiles', { data: null, error: { message: 'Failed to fetch' } })

    const syncService = await import('../syncService')
    await syncService.runFullSync('user-1')

    expect(localStorage.getItem('entrenador_initial_pull_v1:user-1')).toBeNull()
  })

  it('does not mark the initial remote pull complete while the profile recreation lock is still active', async () => {
    localStorageState.set('entrenador_profile_reset_lock_v1', JSON.stringify({
      'user-1': {
        resetAt: 500,
        status: 'awaiting_onboarding_recreation',
      },
    }))
    athleteProfileRows = [{
      id: 'default',
      user_id: 'user-1',
      coach_memory: null,
      updated_at: 500,
      data: {
        __fullResetAt: 500,
        __deletedFields: ['name'],
        __clearCoachMemory: true,
      },
    }]
    tableResults.set('athlete_profiles', { data: athleteProfileRows, error: null })

    const syncService = await import('../syncService')
    await syncService.runFullSync('user-1')

    expect(localStorage.getItem('entrenador_initial_pull_v1:user-1')).toBeNull()
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

  it('drops stale queued ops for an entity after a newer direct write succeeds', async () => {
    localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([
      {
        userId: 'user-1',
        table: 'sessions',
        action: 'upsert',
        payload: {
          id: 'session-1',
          user_id: 'user-1',
          date: '2026-04-11',
          week_start_date: '2026-04-06',
          time_block: 'AM',
          type: 'running',
          status: 'planned',
          created_at: 1,
          updated_at: 10,
          data: { title: 'Vieja' },
        },
        enqueuedAt: 1,
      },
    ]))

    const syncService = await import('../syncService')

    await syncService.pushSession({
      id: 'session-1',
      date: '2026-04-11',
      weekStartDate: '2026-04-06',
      timeBlock: 'AM',
      type: 'running',
      status: 'planned',
      title: 'Nueva',
      durationMin: 50,
      createdAt: 1,
      updatedAt: 20,
    })

    expect(upsertCalls.filter((call) => call.table === 'sessions')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    expect((upsertCalls[0]?.payload as Record<string, unknown>).updated_at).toBe(20)
  })

  it('serializes concurrent direct writes for the same entity', async () => {
    const auth = await import('../auth')
    const supabase = requireMockSupabase(auth)
    const originalFrom = supabase.from.bind(supabase)
    let releaseFirst!: () => void

    supabase.from = ((table: string) => {
      if (table !== 'sessions') return originalFrom(table)
      return {
        upsert: vi.fn((payload: unknown) => {
          upsertCalls.push({ table, payload })
          if (upsertCalls.length === 1) {
            return new Promise<SupabaseResult>((resolve) => {
              releaseFirst = () => resolve({ data: null, error: null })
            })
          }
          return Promise.resolve({ data: null, error: null })
        }),
      }
    }) as typeof supabase.from

    const syncService = await import('../syncService')
    const firstWrite = syncService.pushSession({
      id: 'session-1',
      date: '2026-04-11',
      weekStartDate: '2026-04-06',
      timeBlock: 'AM',
      type: 'running',
      status: 'planned',
      title: 'Primera',
      durationMin: 45,
      createdAt: 1,
      updatedAt: 10,
    })

    await Promise.resolve()

    const secondWrite = syncService.pushSession({
      id: 'session-1',
      date: '2026-04-11',
      weekStartDate: '2026-04-06',
      timeBlock: 'AM',
      type: 'running',
      status: 'planned',
      title: 'Segunda',
      durationMin: 45,
      createdAt: 1,
      updatedAt: 20,
    })

    await Promise.resolve()

    expect(upsertCalls.filter((call) => call.table === 'sessions')).toHaveLength(1)

    releaseFirst()
    await Promise.all([firstWrite, secondWrite])

    expect(upsertCalls.filter((call) => call.table === 'sessions')).toHaveLength(2)
    expect(upsertCalls
      .filter((call) => call.table === 'sessions')
      .map((call) => (call.payload as Record<string, unknown>).updated_at))
      .toEqual([10, 20])
  })

  it('waits for newer local training plan writes before finishing runFullSync', async () => {
    const localPlan = {
      id: 'plan-1',
      athleteId: 'athlete-1',
      goalEventId: 'evt-1',
      status: 'active',
      title: 'Plan local',
      startDate: '2026-04-14',
      endDate: '2026-04-20',
      totalWeeks: 1,
      phases: [],
      wizardConfig: {},
      macroSnapshot: {},
      createdAt: 1,
      updatedAt: 200,
    }
    trainingPlanRows = [localPlan]
    tableResults.set('training_plans', {
      data: [{
        id: 'plan-1',
        user_id: 'user-1',
        goal_event_id: 'evt-1',
        status: 'active',
        title: 'Plan remoto',
        start_date: '2026-04-14',
        end_date: '2026-04-20',
        total_weeks: 1,
        phases: [],
        wizard_config: {},
        macro_snapshot: {},
        created_at: 1,
        updated_at: 100,
        deleted_at: null,
      }],
      error: null,
    })
    tableResults.set('training_plan_weeks', { data: [], error: null })

    const auth = await import('../auth')
    const supabase = requireMockSupabase(auth)
    const originalFrom = supabase.from.bind(supabase)
    let releasePlanWrite!: () => void

    supabase.from = ((table: string) => {
      const base = originalFrom(table)
      if (table !== 'training_plans') return base
      return {
        ...base,
        upsert: vi.fn((payload: unknown) => {
          upsertCalls.push({ table, payload })
          return new Promise<SupabaseResult>((resolve) => {
            releasePlanWrite = () => resolve({ data: null, error: null })
          })
        }),
      }
    }) as typeof supabase.from

    const { db } = await import('../../db/db')
    ;(db.trainingPlans.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) =>
      trainingPlanRows.find((plan) => (plan as { id: string }).id === id),
    )

    const syncService = await import('../syncService')
    let resolved = false
    const fullSyncPromise = syncService.runFullSync('user-1').then(() => {
      resolved = true
    })

    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(resolved).toBe(false)
    expect(typeof releasePlanWrite).toBe('function')

    releasePlanWrite()
    await fullSyncPromise

    expect(resolved).toBe(true)
    expect(upsertCalls.some((call) => call.table === 'training_plans')).toBe(true)
  })
})
