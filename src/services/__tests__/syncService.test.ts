import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATHLETE_PROFILE_LOCAL_ID } from '../athlete/activeAthlete'

type SupabaseResult = { data: unknown; error: unknown }
type SupabaseResultSource = SupabaseResult | SupabaseResult[]

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
  athleteRows = []
  planGenerationJobRows = []
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
let athleteRows: Array<{ id: string; [key: string]: unknown }> = []
let planGenerationJobRows: unknown[] = []
let tableResults = new Map<string, SupabaseResultSource>()
let actionResults = new Map<string, SupabaseResultSource>()
type MockFilter = { op: 'eq' | 'neq' | 'in' | 'or' | 'lt' | 'lte'; column: string; value: unknown }

const upsertCalls: Array<{ table: string; payload: unknown; options?: unknown }> = []
const insertCalls: Array<{ table: string; payload: unknown }> = []
const deleteCalls: Array<{ table: string; filters: Array<MockFilter> }> = []
const updateCalls: Array<{ table: string; payload: unknown; filters: Array<MockFilter> }> = []
const selectCalls: Array<{ table: string; filters: Array<MockFilter> }> = []

function createQueryBuilder(
  table: string,
  action: 'delete' | 'update' | 'select',
  payload?: unknown,
) {
  const filters: Array<MockFilter> = []
  return {
    eq(column: string, value: unknown) {
      filters.push({ op: 'eq', column, value })
      return this
    },
    neq(column: string, value: unknown) {
      filters.push({ op: 'neq', column, value })
      return this
    },
    in(column: string, value: unknown) {
      filters.push({ op: 'in', column, value })
      return this
    },
    or(expression: string) {
      filters.push({ op: 'or', column: 'or', value: expression })
      return this
    },
    lte(column: string, value: unknown) {
      filters.push({ op: 'lte', column, value })
      return this
    },
    lt(column: string, value: unknown) {
      filters.push({ op: 'lt', column, value })
      return this
    },
    limit() {
      return this
    },
    select() {
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

function takeSupabaseResult(source: SupabaseResultSource | undefined): SupabaseResult | undefined {
  if (!Array.isArray(source)) return source
  return source.shift() ?? { data: null, error: null }
}

function getSupabaseResult(table: string, action: 'delete' | 'update' | 'select' | 'upsert' | 'insert'): SupabaseResult {
  return takeSupabaseResult(actionResults.get(`${action}:${table}`))
    ?? takeSupabaseResult(tableResults.get(table))
    ?? { data: null, error: null }
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

function mergeRowsById(current: unknown[], incoming: unknown[]): unknown[] {
  const next = [...current]
  for (const row of incoming) {
    const id = (row as { id?: unknown }).id
    const index = next.findIndex((item) => (item as { id?: unknown }).id === id)
    if (index >= 0) next[index] = row
    else next.push(row)
  }
  return next
}

function putRowById(current: unknown[], row: unknown): unknown[] {
  return mergeRowsById(current, [row])
}

function deleteRowsById(current: unknown[], ids: string[]): unknown[] {
  return current.filter((row) => !ids.includes((row as { id?: string }).id ?? ''))
}

function matchesIndex(row: unknown, index: string, value: unknown): boolean {
  const record = row as Record<string, unknown>
  return record[index] === value
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
      get: vi.fn(async (id: string) => sessionsRows.find((row) => (row as { id?: string }).id === id)),
      put: vi.fn(async (row: unknown) => {
        sessionsRows = putRowById(sessionsRows, row)
      }),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        sessionsRows = mergeRowsById(sessionsRows, rows)
      }),
      delete: vi.fn(async (id: string) => {
        sessionsRows = deleteRowsById(sessionsRows, [id])
      }),
      bulkDelete: vi.fn(async (ids: string[]) => {
        sessionsRows = deleteRowsById(sessionsRows, ids)
      }),
    },
    dayLogs: {
      toArray: vi.fn(async () => dayLogRows),
      count: vi.fn(async () => dayLogRows.length),
      get: vi.fn(async (id: string) => dayLogRows.find((row) => (row as { id?: string }).id === id)),
      put: vi.fn(async (row: unknown) => {
        dayLogRows = putRowById(dayLogRows, row)
      }),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        dayLogRows = mergeRowsById(dayLogRows, rows)
      }),
      delete: vi.fn(async (id: string) => {
        dayLogRows = deleteRowsById(dayLogRows, [id])
      }),
      bulkDelete: vi.fn(async (ids: string[]) => {
        dayLogRows = deleteRowsById(dayLogRows, ids)
      }),
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: unknown) => ({
          first: vi.fn(async () => dayLogRows.find((row) => matchesIndex(row, index, value))),
          toArray: vi.fn(async () => dayLogRows.filter((row) => matchesIndex(row, index, value))),
        })),
      })),
    },
    weekSummaries: {
      toArray: vi.fn(async () => weekSummaryRows),
      count: vi.fn(async () => weekSummaryRows.length),
      get: vi.fn(async (id: string) => weekSummaryRows.find((row) => (row as { id?: string }).id === id)),
      put: vi.fn(async (row: unknown) => {
        weekSummaryRows = putRowById(weekSummaryRows, row)
      }),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        weekSummaryRows = mergeRowsById(weekSummaryRows, rows)
      }),
      delete: vi.fn(async (id: string) => {
        weekSummaryRows = deleteRowsById(weekSummaryRows, [id])
      }),
      bulkDelete: vi.fn(async (ids: string[]) => {
        weekSummaryRows = deleteRowsById(weekSummaryRows, ids)
      }),
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: unknown) => ({
          first: vi.fn(async () => weekSummaryRows.find((row) => matchesIndex(row, index, value))),
          toArray: vi.fn(async () => weekSummaryRows.filter((row) => matchesIndex(row, index, value))),
        })),
      })),
    },
    trainingPlans: {
      toArray: vi.fn(async () => trainingPlanRows),
      count: vi.fn(async () => trainingPlanRows.length),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        trainingPlanRows = mergeRowsById(trainingPlanRows, rows)
      }),
      delete: vi.fn(async () => {}),
      bulkDelete: vi.fn(async () => {}),
    },
    trainingPlanWeeks: {
      toArray: vi.fn(async () => trainingPlanWeekRows),
      count: vi.fn(async () => trainingPlanWeekRows.length),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        trainingPlanWeekRows = mergeRowsById(trainingPlanWeekRows, rows)
      }),
      delete: vi.fn(async () => {}),
      bulkDelete: vi.fn(async () => {}),
      where: vi.fn(() => ({ equals: vi.fn(() => ({ delete: vi.fn(async () => {}), toArray: vi.fn(async () => []) })) })),
    },
    chatMessages: {
      toArray: vi.fn(async () => chatMessageRows),
      count: vi.fn(async () => chatMessageRows.length),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        chatMessageRows = mergeRowsById(chatMessageRows, rows)
      }),
      bulkDelete: vi.fn(async () => {}),
    },
    coachProposals: {
      toArray: vi.fn(async () => coachProposalRows),
      count: vi.fn(async () => coachProposalRows.length),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        coachProposalRows = mergeRowsById(coachProposalRows, rows)
      }),
      bulkDelete: vi.fn(async () => {}),
    },
    athleteProfiles: {
      toArray: vi.fn(async () => athleteProfileRows),
      count: vi.fn(async () => athleteProfileRows.length),
      get: vi.fn(async (id: string) => athleteProfileRows.find((row) => (row as { id?: string }).id === id)),
      put: vi.fn(async (row: unknown) => {
        athleteProfileRows = putRowById(athleteProfileRows, row)
      }),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        athleteProfileRows = mergeRowsById(athleteProfileRows, rows)
      }),
      delete: vi.fn(async (id: string) => {
        athleteProfileRows = deleteRowsById(athleteProfileRows, [id])
      }),
      clear: vi.fn(async () => {
        athleteProfileRows = []
      }),
    },
    athletes: {
      toArray: vi.fn(async () => athleteRows),
      count: vi.fn(async () => athleteRows.length),
      get: vi.fn(async (id: string) => athleteRows.find((row) => row.id === id)),
      put: vi.fn(async (row: { id: string; [key: string]: unknown }) => {
        const index = athleteRows.findIndex((item) => item.id === row.id)
        if (index >= 0) athleteRows[index] = row
        else athleteRows.push(row)
      }),
      bulkPut: vi.fn(async (rows: Array<{ id: string; [key: string]: unknown }>) => {
        for (const row of rows) {
          const index = athleteRows.findIndex((item) => item.id === row.id)
          if (index >= 0) athleteRows[index] = row
          else athleteRows.push(row)
        }
      }),
      clear: vi.fn(async () => {
        athleteRows = []
      }),
    },
    planGenerationJobs: {
      toArray: vi.fn(async () => planGenerationJobRows),
      count: vi.fn(async () => planGenerationJobRows.length),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        planGenerationJobRows = rows
      }),
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
    athleteRows = []
    planGenerationJobRows = []
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
    vi.unstubAllEnvs()
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

  it('stamps athlete_id during bulk migration and ensures the remote athlete first', async () => {
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

    const syncService = await import('../syncService')
    await syncService.migrateLocalDataToCloud('user-1')

    expect(upsertCalls[0]?.table).toBe('athletes')
    const athletePayload = upsertCalls[0]?.payload as Record<string, unknown>
    expect(athletePayload.id).toBe('ath_user-1')
    expect(athletePayload.owner_account_id).toBe('user-1')

    const sessionUpsert = upsertCalls.find((call) => call.table === 'sessions')
    const sessionPayload = (sessionUpsert?.payload as Array<Record<string, unknown>>)[0]
    expect(sessionPayload.athlete_id).toBe('ath_user-1')
  })

  it('migrates syncable plans (active, archived, draft, superseded) and their weeks', async () => {
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
    // draft plans are now syncable (needed for async generation)
    const syncedPlanIds = (planUpsert?.payload as Array<Record<string, unknown>>).map((p) => p.id)
    expect(syncedPlanIds).toContain('plan-active')
    expect(syncedPlanIds).toContain('plan-draft')
    expect(weekUpsert).toBeTruthy()
    const syncedWeekIds = (weekUpsert?.payload as Array<Record<string, unknown>>).map((w) => w.id)
    expect(syncedWeekIds).toContain('week-active')
    expect(syncedWeekIds).toContain('week-draft')
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

  it('ensures the remote athlete before pushing scoped rows', async () => {
    const syncService = await import('../syncService')

    await syncService.pushSession({
      id: 'session-1',
      athleteId: 'ath_user-1',
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

    expect(upsertCalls[0]?.table).toBe('athletes')
    expect(upsertCalls[1]?.table).toBe('sessions')
    expect(upsertCalls[1]?.payload).toMatchObject({
      id: 'session-1',
      athlete_id: 'ath_user-1',
    })
  })

  it('pushear el perfil de un gestionado no repara/borra el perfil remoto del self', async () => {
    const { setActiveAthleteId, setSelfAthleteId } = await import('../athlete/activeAthlete')
    const { db: mockedDb } = await import('../../db/db')
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_m_1')
    try {
      const now = Date.now()
      await mockedDb.athletes.put({
        id: 'ath_m_1',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      } as never)
      actionResults.set('select:athlete_profiles', {
        data: [{
          id: 'profile:user-1',
          user_id: 'user-1',
          athlete_id: 'ath_user-1',
          coach_memory: null,
          updated_at: 5,
          data: { name: 'Rafa' },
        }],
        error: null,
      })
      const syncService = await import('../syncService')
      await syncService.pushAthleteProfile({
        id: 'ath_m_1',
        athleteId: 'ath_m_1',
        updatedAt: 10,
        name: 'Cliente 1',
      } as never)

      const profileUpsert = upsertCalls.find((call) => call.table === 'athlete_profiles')
      expect(profileUpsert?.payload).toMatchObject({
        id: 'profile:user-1:ath_m_1',
        athlete_id: 'ath_m_1',
      })
      expect(profileUpsert?.options).toMatchObject({ onConflict: 'user_id,athlete_id' })
      expect(updateCalls.find((call) => call.table === 'athlete_profiles')).toBeUndefined()
      expect(deleteCalls.find((call) => call.table === 'athlete_profiles')).toBeUndefined()
    } finally {
      setActiveAthleteId(null)
      setSelfAthleteId(null)
    }
  })

  it('repairAthleteProfileDuplicates NO trata self + gestionado como duplicados', async () => {
    const { setSelfAthleteId } = await import('../athlete/activeAthlete')
    setSelfAthleteId('ath_user-1')
    try {
      actionResults.set('select:athlete_profiles', {
        data: [
          {
            id: 'profile:user-1',
            user_id: 'user-1',
            athlete_id: 'ath_user-1',
            coach_memory: null,
            updated_at: 5,
            data: { name: 'Rafa' },
          },
          {
            id: 'profile:user-1:ath_m_1',
            user_id: 'user-1',
            athlete_id: 'ath_m_1',
            coach_memory: null,
            updated_at: 6,
            data: { name: 'Cliente 1' },
          },
        ],
        error: null,
      })
      const syncService = await import('../syncService')
      const result = await syncService.repairAthleteProfileDuplicates('user-1')

      expect(result).toMatchObject({ remoteRowsBefore: 2, repaired: false })
      expect(deleteCalls.filter((call) => call.table === 'athlete_profiles')).toHaveLength(0)
    } finally {
      setSelfAthleteId(null)
    }
  })

  it('repairAthleteProfileDuplicates estampa athlete_id self al reparar duplicados legacy', async () => {
    actionResults.set('select:athlete_profiles', {
      data: [
        {
          id: 'legacy-a',
          user_id: 'user-1',
          athlete_id: null,
          coach_memory: null,
          updated_at: 5,
          data: { name: 'A' },
        },
        {
          id: 'legacy-b',
          user_id: 'user-1',
          athlete_id: null,
          coach_memory: null,
          updated_at: 10,
          data: { name: 'B' },
        },
      ],
      error: null,
    })

    const syncService = await import('../syncService')
    const result = await syncService.repairAthleteProfileDuplicates('user-1')

    expect(result).toMatchObject({ remoteRowsBefore: 2, repaired: true })
    expect(updateCalls.find((call) => call.table === 'athlete_profiles')?.payload)
      .toMatchObject({ athlete_id: 'ath_user-1' })
  })

  it('pushear un day log de un gestionado asegura SU fila de athletes primero', async () => {
    const { setActiveAthleteId, setSelfAthleteId } = await import('../athlete/activeAthlete')
    const { db: mockedDb } = await import('../../db/db')
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_m_1')
    try {
      const now = Date.now()
      await mockedDb.athletes.put({
        id: 'ath_m_1',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      } as never)

      const syncService = await import('../syncService')
      await syncService.pushDayLog({ id: 'dl-1', date: '2026-07-06', updatedAt: 10, athleteId: 'ath_m_1' } as never)

      const managedEnsureIdx = upsertCalls.findIndex((call) =>
        call.table === 'athletes' && (call.payload as { id?: string }).id === 'ath_m_1')
      const childIdx = upsertCalls.findIndex((call) => call.table === 'day_logs')
      expect(managedEnsureIdx).toBeGreaterThanOrEqual(0)
      expect(childIdx).toBeGreaterThan(managedEnsureIdx)
    } finally {
      setActiveAthleteId(null)
      setSelfAthleteId(null)
    }
  })

  it('drenar una op encolada de un gestionado asegura SU fila de athletes antes del child', async () => {
    const { setSelfAthleteId } = await import('../athlete/activeAthlete')
    const { db: mockedDb } = await import('../../db/db')
    setSelfAthleteId('ath_user-1')
    try {
      const now = Date.now()
      await mockedDb.athletes.put({
        id: 'ath_m_1',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      } as never)
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([
        {
          table: 'day_logs',
          action: 'upsert',
          userId: 'user-1',
          enqueuedAt: 1,
          attempts: 0,
          payload: {
            id: 'dl-q1',
            user_id: 'user-1',
            date: '2026-07-06',
            updated_at: 10,
            athlete_id: 'ath_m_1',
          },
        },
      ]))

      const syncService = await import('../syncService')
      await syncService.drainQueue()

      const managedEnsureIdx = upsertCalls.findIndex((call) =>
        call.table === 'athletes' && (call.payload as { id?: string }).id === 'ath_m_1')
      const childIdx = upsertCalls.findIndex((call) => call.table === 'day_logs')
      expect(managedEnsureIdx).toBeGreaterThanOrEqual(0)
      expect(childIdx).toBeGreaterThan(managedEnsureIdx)
    } finally {
      setSelfAthleteId(null)
    }
  })

  it('un gestionado inexistente localmente NO escribe el child row', async () => {
    const { setActiveAthleteId, setSelfAthleteId } = await import('../athlete/activeAthlete')
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_ghost')
    try {
      const syncService = await import('../syncService')
      await syncService.pushDayLog({ id: 'dl-2', date: '2026-07-06', updatedAt: 10, athleteId: 'ath_ghost' } as never)
      expect(upsertCalls.find((call) => call.table === 'day_logs')).toBeUndefined()
    } finally {
      setActiveAthleteId(null)
      setSelfAthleteId(null)
    }
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

  it('merges day logs by effective athlete key during a full-user pull', async () => {
    const { setActiveAthleteId } = await import('../athlete/activeAthlete')
    setActiveAthleteId('ath_A')
    dayLogRows = [
      { id: 'local-a', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1, sleepHours: 5 },
      { id: 'local-b', athleteId: 'ath_B', date: '2026-06-30', updatedAt: 1, sleepHours: 4 },
    ]
    tableResults.set('day_logs', {
      data: [{
        id: 'remote-b',
        user_id: 'user-1',
        athlete_id: 'ath_B',
        date: '2026-06-30',
        updated_at: 9,
        data: { sleepHours: 8 },
      }],
      error: null,
    })

    const syncService = await import('../syncService')
    await syncService.runFullSync('user-1')

    expect(dayLogRows.map((row) => (row as { id: string }).id).sort()).toEqual(['local-a', 'remote-b'])
    expect(dayLogRows.find((row) => (row as { id: string }).id === 'local-a')).toMatchObject({
      athleteId: 'ath_A',
      sleepHours: 5,
    })
    expect(dayLogRows.find((row) => (row as { id: string }).id === 'remote-b')).toMatchObject({
      athleteId: 'ath_B',
      sleepHours: 8,
    })
  })

  it('a full pull with a MANAGED athlete active stamps legacy rows with the SELF athlete', async () => {
    const { setActiveAthleteId, setSelfAthleteId, getActiveAthleteId } = await import('../athlete/activeAthlete')
    const { persistAthleteSelection } = await import('../athlete/athleteSelection')
    const { db: mockedDb } = await import('../../db/db')
    // Coach entrenando a un gestionado: selección persistida válida + fila local
    // del gestionado, para que la re-hidratación del sync la respete (Task 8).
    const now = Date.now()
    await mockedDb.athletes.put({ id: 'ath_m_1', ownerAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now } as never)
    persistAthleteSelection('user-1', 'ath_m_1')
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_m_1')

    tableResults.set('day_logs', {
      data: [{
        id: 'remote-legacy',
        user_id: 'user-1',
        athlete_id: null,
        date: '2026-06-30',
        updated_at: 50,
        data: { sleepHours: 7 },
      }],
      error: null,
    })

    const syncService = await import('../syncService')
    await syncService.runFullSync('user-1')

    // La fila legacy pertenece al SELF resuelto (ath_user-1), nunca al gestionado activo.
    const local = dayLogRows.find((row) => (row as { id: string }).id === 'remote-legacy')
    expect(local).toMatchObject({ athleteId: 'ath_user-1' })
    // Y el sync NO pisó la selección del gestionado (hidratación selection-aware).
    expect(getActiveAthleteId()).toBe('ath_m_1')

    persistAthleteSelection('user-1', null)
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('un full pull con perfiles de self y gestionado converge cada uno a su fila local', async () => {
    const { setSelfAthleteId, setActiveAthleteId } = await import('../athlete/activeAthlete')
    setSelfAthleteId('ath_user-1')
    try {
      actionResults.set('select:athlete_profiles', {
        data: [
          {
            id: 'profile:user-1',
            user_id: 'user-1',
            athlete_id: 'ath_user-1',
            coach_memory: null,
            updated_at: 20,
            data: { name: 'Rafa' },
          },
          {
            id: 'profile:user-1:ath_m_1',
            user_id: 'user-1',
            athlete_id: 'ath_m_1',
            coach_memory: null,
            updated_at: 30,
            data: { name: 'Cliente 1' },
          },
        ],
        error: null,
      })

      const syncService = await import('../syncService')
      await syncService.runFullSync('user-1')

      const self = athleteProfileRows.find((profile) => (profile as { id?: string }).id === ATHLETE_PROFILE_LOCAL_ID)
      const managed = athleteProfileRows.find((profile) => (profile as { id?: string }).id === 'ath_m_1')
      expect(self).toMatchObject({ name: 'Rafa' })
      expect(managed).toMatchObject({ name: 'Cliente 1', athleteId: 'ath_m_1' })
      expect(deleteCalls.filter((call) => call.table === 'athlete_profiles')).toHaveLength(0)
    } finally {
      setSelfAthleteId(null)
      setActiveAthleteId(null)
    }
  })

  it('self remoto vacío en ventana de deletes borra SOLO la fila default, nunca perfiles gestionados', async () => {
    const { setSelfAthleteId, setActiveAthleteId } = await import('../athlete/activeAthlete')
    setSelfAthleteId('ath_user-1')
    storeState.syncDetails.lastSuccessfulSyncAt = 10
    try {
      athleteProfileRows = [
        { id: ATHLETE_PROFILE_LOCAL_ID, athleteId: 'ath_user-1', updatedAt: 5, name: 'Rafa' },
        { id: 'ath_m_1', athleteId: 'ath_m_1', updatedAt: 50, name: 'Cliente 1' },
      ]
      actionResults.set('select:athlete_profiles', {
        data: [{
          id: 'profile:user-1:ath_m_1',
          user_id: 'user-1',
          athlete_id: 'ath_m_1',
          coach_memory: null,
          updated_at: 50,
          data: { name: 'Cliente 1' },
        }],
        error: null,
      })

      const syncService = await import('../syncService')
      await syncService.runFullSync('user-1')

      expect(athleteProfileRows.find((profile) => (profile as { id?: string }).id === ATHLETE_PROFILE_LOCAL_ID)).toBeUndefined()
      expect(athleteProfileRows.find((profile) => (profile as { id?: string }).id === 'ath_m_1')).toBeDefined()
    } finally {
      setSelfAthleteId(null)
      setActiveAthleteId(null)
    }
  })

  it('un gestionado local sin remoto dentro de la ventana de deletes se borra en vez de resucitar', async () => {
    const { setSelfAthleteId, setActiveAthleteId } = await import('../athlete/activeAthlete')
    setSelfAthleteId('ath_user-1')
    storeState.syncDetails.lastSuccessfulSyncAt = 10
    try {
      athleteProfileRows = [
        { id: 'ath_m_del', athleteId: 'ath_m_del', updatedAt: 5, name: 'Ex cliente' },
      ]
      actionResults.set('select:athlete_profiles', {
        data: [{
          id: 'profile:user-1',
          user_id: 'user-1',
          athlete_id: 'ath_user-1',
          coach_memory: null,
          updated_at: 20,
          data: { name: 'Rafa' },
        }],
        error: null,
      })

      const syncService = await import('../syncService')
      await syncService.runFullSync('user-1')

      expect(athleteProfileRows.find((profile) => (profile as { id?: string }).id === 'ath_m_del')).toBeUndefined()
      expect(upsertCalls.find((call) =>
        call.table === 'athlete_profiles'
        && (call.payload as { id?: string }).id === 'profile:user-1:ath_m_del',
      )).toBeUndefined()
    } finally {
      setSelfAthleteId(null)
      setActiveAthleteId(null)
    }
  })

  it('only deletes missing day logs inside an athlete-scoped pull', async () => {
    vi.stubEnv('VITE_ATHLETE_SCOPE', 'true')
    const { setActiveAthleteId } = await import('../athlete/activeAthlete')
    setActiveAthleteId('ath_A')
    storeState.syncDetails.lastSuccessfulSyncAt = 1_000
    sessionsRows = [
      { id: 'SA1', athleteId: 'ath_user-1', date: '2026-06-30', updatedAt: 10 },
      { id: 'SB1', athleteId: 'ath_B', date: '2026-07-01', updatedAt: 10 },
      { id: 'SL1', date: '2026-07-02', updatedAt: 10 },
    ]
    dayLogRows = [
      { id: 'A1', athleteId: 'ath_user-1', date: '2026-06-30', updatedAt: 10 },
      { id: 'B1', athleteId: 'ath_B', date: '2026-07-01', updatedAt: 10 },
      { id: 'L1', date: '2026-07-02', updatedAt: 10 },
    ]
    tableResults.set('sessions', { data: [], error: null })
    tableResults.set('day_logs', { data: [], error: null })

    const syncService = await import('../syncService')
    await syncService.runFullSync('user-1')

    expect(sessionsRows.map((row) => (row as { id: string }).id)).toEqual(['SB1'])
    expect(dayLogRows.map((row) => (row as { id: string }).id)).toEqual(['B1'])
  })

  it('deletes missing day logs across all athletes during a full-user pull', async () => {
    const { setActiveAthleteId } = await import('../athlete/activeAthlete')
    setActiveAthleteId('ath_A')
    storeState.syncDetails.lastSuccessfulSyncAt = 1_000
    dayLogRows = [
      { id: 'A1', athleteId: 'ath_user-1', date: '2026-06-30', updatedAt: 10 },
      { id: 'B1', athleteId: 'ath_B', date: '2026-07-01', updatedAt: 10 },
      { id: 'L1', date: '2026-07-02', updatedAt: 10 },
    ]
    tableResults.set('day_logs', { data: [], error: null })

    const syncService = await import('../syncService')
    await syncService.runFullSync('user-1')

    expect(dayLogRows).toEqual([])
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
      'athletes',
    ])
    expect(updateCalls.some((call) => call.table === 'athlete_profiles')).toBe(false)
    expect(upsertCalls.some((call) => call.table === 'athlete_profiles')).toBe(true)
    expect(insertCalls.some((call) => call.table === 'athlete_profiles')).toBe(false)
    expect(deleteCalls.find((call) => call.table === 'athletes')?.filters).toEqual([
      { op: 'eq', column: 'owner_account_id', value: 'user-1' },
      { op: 'neq', column: 'id', value: 'ath_user-1' },
    ])
    expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    expect(localStorage.getItem('entrenador_profile_reset_lock_v1')).toContain('awaiting_bootstrap_ack')
    expect(outcome.completed).toBe(true)
    expect(outcome.pending).toEqual([])
  })

  it('preserves the self athlete so the full reset marker is not cascade-deleted', async () => {
    const syncService = await import('../syncService')
    await syncService.wipeRemoteAndLocalAppData('user-1')

    const selfAthleteUpsertIndex = upsertCalls.findIndex((call) =>
      call.table === 'athletes'
      && (call.payload as { id?: string }).id === 'ath_user-1',
    )
    const markerUpsertIndex = upsertCalls.findIndex((call) =>
      call.table === 'athlete_profiles'
      && ((call.payload as { data?: Record<string, unknown> }).data?.__fullResetAt != null),
    )
    const athleteDelete = deleteCalls.find((call) => call.table === 'athletes')

    expect(selfAthleteUpsertIndex).toBeGreaterThanOrEqual(0)
    expect(markerUpsertIndex).toBeGreaterThan(selfAthleteUpsertIndex)
    expect(athleteDelete?.filters).toEqual([
      { op: 'eq', column: 'owner_account_id', value: 'user-1' },
      { op: 'neq', column: 'id', value: 'ath_user-1' },
    ])
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
    await db.athletes.put({
      id: 'athlete-1',
      ownerAccountId: 'user-1',
      linkedAccountId: null,
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    } as never)
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

  describe('reconcileNaturalKeyConflict', () => {
    let reconcile: typeof import('../syncService')['reconcileNaturalKeyConflict']
    beforeEach(async () => {
      reconcile = (await import('../syncService')).reconcileNaturalKeyConflict
    })

    const basePayload = () => ({
      id: 'local-a', user_id: 'user-1', athlete_id: 'ath_A',
      date: '2026-06-30', updated_at: 10, data: {},
    })

    it('non-23505 error is not reconciled', async () => {
      expect(await reconcile('day_logs', basePayload(), 'user-1', { code: '23503' })).toBe(false)
    })

    it('non day/week table is not reconciled', async () => {
      expect(await reconcile('sessions', basePayload(), 'user-1', { code: '23505' })).toBe(false)
    })

    it('payload without athlete_id is not reconciled', async () => {
      const noAthlete = { ...basePayload() }
      delete (noAthlete as Record<string, unknown>).athlete_id
      expect(await reconcile('day_logs', noAthlete, 'user-1', { code: '23505' })).toBe(false)
    })

    it('payload without the natural date column is not reconciled', async () => {
      const noDate = { ...basePayload() }
      delete (noDate as Record<string, unknown>).date
      expect(await reconcile('day_logs', noDate, 'user-1', { code: '23505' })).toBe(false)
    })

    it('local newer → atomic conditional update by remote id (id stripped from body)', async () => {
      actionResults.set('select:day_logs', { data: [{ id: 'remote-b', updated_at: 5 }], error: null })
      actionResults.set('update:day_logs', { data: [{ id: 'remote-b' }], error: null })
      expect(await reconcile('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(true)
      const upd = updateCalls.find((c) => c.table === 'day_logs')
      expect(upd?.filters).toEqual(expect.arrayContaining([
        { op: 'eq', column: 'id', value: 'remote-b' },
        { op: 'eq', column: 'user_id', value: 'user-1' },
        { op: 'eq', column: 'athlete_id', value: 'ath_A' },
        { op: 'eq', column: 'date', value: '2026-06-30' },
        { op: 'lt', column: 'updated_at', value: 10 },
      ]))
      expect((upd?.payload as Record<string, unknown>).id).toBeUndefined()
    })

    it('remote newer/equal (tie) → skip, no update issued', async () => {
      actionResults.set('select:day_logs', { data: [{ id: 'remote-b', updated_at: 10 }], error: null })
      expect(await reconcile('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(true)
      expect(updateCalls.find((c) => c.table === 'day_logs')).toBeUndefined()
    })

    it('conditional update affects 0 rows and natural key still exists → handled skip', async () => {
      actionResults.set('select:day_logs', [
        { data: [{ id: 'remote-b', updated_at: 5 }], error: null },
        { data: [{ id: 'remote-b', updated_at: 10 }], error: null },
      ])
      actionResults.set('update:day_logs', { data: [], error: null })
      expect(await reconcile('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(true)
      expect(upsertCalls.filter((c) => c.table === 'day_logs')).toHaveLength(0)
    })

    it('conditional update affects 0 rows and natural key disappeared → retry upsert once', async () => {
      actionResults.set('select:day_logs', [
        { data: [{ id: 'remote-b', updated_at: 5 }], error: null },
        { data: [], error: null },
      ])
      actionResults.set('update:day_logs', { data: [], error: null })
      actionResults.set('upsert:day_logs', { data: null, error: null })
      expect(await reconcile('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(true)
      expect(upsertCalls.filter((c) => c.table === 'day_logs')).toHaveLength(1)
    })

    it('legacy (user_id,date) 23505 same athlete reconciles like post-008b', async () => {
      actionResults.set('select:day_logs', { data: [{ id: 'remote-b', updated_at: 5 }], error: null })
      actionResults.set('update:day_logs', { data: [{ id: 'remote-b' }], error: null })
      expect(await reconcile('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(true)
    })

    it('SELECT finds no row → retry upsert once (success → handled)', async () => {
      actionResults.set('select:day_logs', { data: [], error: null })
      actionResults.set('upsert:day_logs', { data: null, error: null })
      expect(await reconcile('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(true)
      expect(upsertCalls.filter((c) => c.table === 'day_logs').length).toBe(1)
    })

    it('SELECT none → retry still 23505 → not handled (no false success)', async () => {
      actionResults.set('select:day_logs', { data: [], error: null })
      actionResults.set('upsert:day_logs', { data: null, error: { code: '23505' } })
      expect(await reconcile('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(false)
    })

    it('SELECT fails with a non-23505 error → throws the REAL error (not the original 23505)', async () => {
      actionResults.set('select:day_logs', { data: null, error: { message: 'network down', status: 503 } })
      await expect(reconcile('day_logs', basePayload(), 'user-1', { code: '23505' }))
        .rejects.toMatchObject({ status: 503 })
    })

    it('retry fails with a non-23505 error → throws the REAL error', async () => {
      actionResults.set('select:day_logs', { data: [], error: null })
      actionResults.set('upsert:day_logs', { data: null, error: { message: 'jwt expired', status: 401 } })
      await expect(reconcile('day_logs', basePayload(), 'user-1', { code: '23505' }))
        .rejects.toMatchObject({ status: 401 })
    })

    it('conditional update fails with a non-23505 error → throws the REAL error', async () => {
      actionResults.set('select:day_logs', { data: [{ id: 'remote-b', updated_at: 5 }], error: null })
      actionResults.set('update:day_logs', { data: null, error: { message: 'rls denied', status: 403 } })
      await expect(reconcile('day_logs', basePayload(), 'user-1', { code: '23505' }))
        .rejects.toMatchObject({ status: 403 })
    })

    it('non-finite remote updated_at → safe path (not handled)', async () => {
      actionResults.set('select:day_logs', { data: [{ id: 'remote-b', updated_at: 'nope' }], error: null })
      expect(await reconcile('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(false)
    })

    it('week_summaries uses week_start_date as the natural date column', async () => {
      const wk = { id: 'local-w', user_id: 'user-1', athlete_id: 'ath_A', week_start_date: '2026-06-29', updated_at: 10, data: {} }
      actionResults.set('select:week_summaries', { data: [{ id: 'remote-w', updated_at: 5 }], error: null })
      actionResults.set('update:week_summaries', { data: [{ id: 'remote-w' }], error: null })
      expect(await reconcile('week_summaries', wk, 'user-1', { code: '23505' })).toBe(true)
      const sel = selectCalls.find((c) => c.table === 'week_summaries')
      expect(sel?.filters).toEqual(expect.arrayContaining([{ op: 'eq', column: 'week_start_date', value: '2026-06-29' }]))
      const upd = updateCalls.find((c) => c.table === 'week_summaries')
      expect(upd?.filters).toEqual(expect.arrayContaining([
        { op: 'eq', column: 'id', value: 'remote-w' },
        { op: 'eq', column: 'athlete_id', value: 'ath_A' },
        { op: 'eq', column: 'week_start_date', value: '2026-06-29' },
        { op: 'lt', column: 'updated_at', value: 10 },
      ]))
    })
  })

  describe('pushDayLog reconciles a 23505 instead of throwing', () => {
    it('does not throw and issues a conditional update when local is newer', async () => {
      const { db } = await import('../../db/db')
      await db.athletes.put({
        id: 'ath_A',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      } as never)
      actionResults.set('upsert:day_logs', { data: null, error: { code: '23505' } })
      actionResults.set('select:day_logs', { data: [{ id: 'remote-b', updated_at: 1 }], error: null })
      actionResults.set('update:day_logs', { data: [{ id: 'remote-b' }], error: null })

      const syncService = await import('../syncService')
      await expect(
        syncService.pushDayLog({ id: 'local-a', date: '2026-06-30', updatedAt: 10, athleteId: 'ath_A' } as never),
      ).resolves.not.toThrow()

      expect(updateCalls.find((c) => c.table === 'day_logs')).toBeDefined()
    })
  })
})
