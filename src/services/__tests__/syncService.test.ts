import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATHLETE_PROFILE_LOCAL_ID } from '../athlete/activeAthlete'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

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
  sessionTemplateRows = []
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
let athleteCoachNoteRows: Array<{ athleteId: string; updatedAt: number; [key: string]: unknown }> = []
let athleteMembershipRows: Array<{ athleteId: string; accountId: string; role: string; createdAt: number; updatedAt: number }> = []
let athleteRows: Array<{ id: string; [key: string]: unknown }> = []
let planGenerationJobRows: unknown[] = []
let readinessDailyRows: unknown[] = []
let whoopWorkoutRows: unknown[] = []
let sessionTemplateRows: unknown[] = []
let tableResults = new Map<string, SupabaseResultSource>()
let actionResults = new Map<string, SupabaseResultSource>()
type MockFilter = { op: 'eq' | 'neq' | 'in' | 'or' | 'is' | 'lt' | 'lte' | 'gte'; column: string; value: unknown }

const upsertCalls: Array<{ table: string; payload: unknown; options?: unknown }> = []
const insertCalls: Array<{ table: string; payload: unknown }> = []
const deleteCalls: Array<{ table: string; filters: Array<MockFilter> }> = []
const updateCalls: Array<{ table: string; payload: unknown; filters: Array<MockFilter> }> = []
const selectCalls: Array<{ table: string; filters: Array<MockFilter> }> = []
const selectHooks = new Map<string, () => Promise<SupabaseResult>>()
const upsertHooks = new Map<string, () => Promise<SupabaseResult>>()
const getSessionMock = vi.fn(async () => ({ data: { session: { access_token: 'supabase-token' } } }))
const whoopDeleteFetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response)

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
    is(column: string, value: unknown) {
      filters.push({ op: 'is', column, value })
      return this
    },
    lte(column: string, value: unknown) {
      filters.push({ op: 'lte', column, value })
      return this
    },
    gte(column: string, value: unknown) {
      filters.push({ op: 'gte', column, value })
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
        const hook = selectHooks.get(table)
        if (hook) return hook().then(onFulfilled)
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
      const hook = upsertHooks.get(table)
      if (hook) return hook()
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
  if (index.startsWith('[') && index.endsWith(']') && Array.isArray(value)) {
    const keys = index.slice(1, -1).split('+')
    return keys.every((key, position) => record[key] === value[position])
  }
  return record[index] === value
}

const supabaseMock = {
  from: createSupabaseFrom(),
  rpc: vi.fn(async () => ({ data: true, error: null })),
  auth: {
    getSession: getSessionMock,
  },
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
      update: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        sessionsRows = sessionsRows.map((row) =>
          (row as { id?: string }).id === id ? { ...(row as object), ...patch } : row)
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
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: unknown) => ({
          delete: vi.fn(async () => {
            sessionsRows = sessionsRows.filter((row) => !matchesIndex(row, index, value))
          }),
        })),
      })),
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
          delete: vi.fn(async () => {
            dayLogRows = dayLogRows.filter((row) => !matchesIndex(row, index, value))
          }),
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
          delete: vi.fn(async () => {
            weekSummaryRows = weekSummaryRows.filter((row) => !matchesIndex(row, index, value))
          }),
        })),
      })),
    },
    trainingPlans: {
      toArray: vi.fn(async () => trainingPlanRows),
      count: vi.fn(async () => trainingPlanRows.length),
      get: vi.fn(async (id: string) =>
        trainingPlanRows.find((row) => (row as { id?: string }).id === id)),
      put: vi.fn(async (row: unknown) => {
        trainingPlanRows = putRowById(trainingPlanRows, row)
      }),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        trainingPlanRows = mergeRowsById(trainingPlanRows, rows)
      }),
      delete: vi.fn(async (id: string) => {
        trainingPlanRows = deleteRowsById(trainingPlanRows, [id])
      }),
      bulkDelete: vi.fn(async (ids: string[]) => {
        trainingPlanRows = deleteRowsById(trainingPlanRows, ids)
      }),
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: unknown) => ({
          delete: vi.fn(async () => {
            trainingPlanRows = trainingPlanRows.filter((row) => !matchesIndex(row, index, value))
          }),
        })),
      })),
    },
    trainingPlanWeeks: {
      toArray: vi.fn(async () => trainingPlanWeekRows),
      count: vi.fn(async () => trainingPlanWeekRows.length),
      get: vi.fn(async (id: string) =>
        trainingPlanWeekRows.find((row) => (row as { id?: string }).id === id)),
      put: vi.fn(async (row: unknown) => {
        trainingPlanWeekRows = putRowById(trainingPlanWeekRows, row)
      }),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        trainingPlanWeekRows = mergeRowsById(trainingPlanWeekRows, rows)
      }),
      delete: vi.fn(async (id: string) => {
        trainingPlanWeekRows = deleteRowsById(trainingPlanWeekRows, [id])
      }),
      bulkDelete: vi.fn(async (ids: string[]) => {
        trainingPlanWeekRows = deleteRowsById(trainingPlanWeekRows, ids)
      }),
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: unknown) => ({
          delete: vi.fn(async () => {
            trainingPlanWeekRows = trainingPlanWeekRows
              .filter((row) => !matchesIndex(row, index, value))
          }),
          toArray: vi.fn(async () =>
            trainingPlanWeekRows.filter((row) => matchesIndex(row, index, value))),
        })),
      })),
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
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: unknown) => ({
          delete: vi.fn(async () => {
            chatMessageRows = chatMessageRows.filter((row) => !matchesIndex(row, index, value))
          }),
        })),
      })),
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
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: unknown) => ({
          delete: vi.fn(async () => {
            coachProposalRows = coachProposalRows.filter((row) => !matchesIndex(row, index, value))
          }),
        })),
      })),
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
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: unknown) => ({
          delete: vi.fn(async () => {
            athleteProfileRows = athleteProfileRows.filter((row) => !matchesIndex(row, index, value))
          }),
        })),
      })),
    },
    athleteCoachNotes: {
      toArray: vi.fn(async () => athleteCoachNoteRows),
      get: vi.fn(async (athleteId: string) => athleteCoachNoteRows.find((row) => row.athleteId === athleteId)),
      put: vi.fn(async (row: { athleteId: string; updatedAt: number; [key: string]: unknown }) => {
        const index = athleteCoachNoteRows.findIndex((item) => item.athleteId === row.athleteId)
        if (index >= 0) athleteCoachNoteRows[index] = row
        else athleteCoachNoteRows.push(row)
      }),
      delete: vi.fn(async (athleteId: string) => {
        athleteCoachNoteRows = athleteCoachNoteRows.filter((row) => row.athleteId !== athleteId)
      }),
    },
    athleteMemberships: {
      toArray: vi.fn(async () => athleteMembershipRows),
      get: vi.fn(async ([athleteId, accountId]: [string, string]) =>
        athleteMembershipRows.find((row) => row.athleteId === athleteId && row.accountId === accountId)),
      bulkPut: vi.fn(async (rows: typeof athleteMembershipRows) => {
        for (const row of rows) {
          const index = athleteMembershipRows.findIndex((item) =>
            item.athleteId === row.athleteId && item.accountId === row.accountId)
          if (index >= 0) athleteMembershipRows[index] = row
          else athleteMembershipRows.push(row)
        }
      }),
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: string) => ({
          toArray: vi.fn(async () => athleteMembershipRows.filter((row) =>
            (row as unknown as Record<string, unknown>)[index] === value)),
          delete: vi.fn(async () => {
            athleteMembershipRows = athleteMembershipRows.filter((row) =>
              (row as unknown as Record<string, unknown>)[index] !== value)
          }),
        })),
      })),
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
      delete: vi.fn(async (id: string) => {
        athleteRows = athleteRows.filter((row) => row.id !== id)
      }),
      clear: vi.fn(async () => {
        athleteRows = []
      }),
    },
    planGenerationJobs: {
      toArray: vi.fn(async () => planGenerationJobRows),
      count: vi.fn(async () => planGenerationJobRows.length),
      get: vi.fn(async (id: string) =>
        planGenerationJobRows.find((row) => (row as { id?: string }).id === id)),
      put: vi.fn(async (row: unknown) => {
        planGenerationJobRows = putRowById(planGenerationJobRows, row)
      }),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        planGenerationJobRows = mergeRowsById(planGenerationJobRows, rows)
      }),
      delete: vi.fn(async (id: string) => {
        planGenerationJobRows = deleteRowsById(planGenerationJobRows, [id])
      }),
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: unknown) => ({
          delete: vi.fn(async () => {
            planGenerationJobRows = planGenerationJobRows
              .filter((row) => !matchesIndex(row, index, value))
          }),
          toArray: vi.fn(async () =>
            planGenerationJobRows.filter((row) => matchesIndex(row, index, value))),
        })),
      })),
    },
    readinessDaily: {
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: unknown) => ({
          delete: vi.fn(async () => {
            readinessDailyRows = readinessDailyRows.filter((row) => !matchesIndex(row, index, value))
          }),
        })),
      })),
    },
    whoopWorkouts: {
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: unknown) => ({
          delete: vi.fn(async () => {
            whoopWorkoutRows = whoopWorkoutRows.filter((row) => !matchesIndex(row, index, value))
          }),
        })),
      })),
    },
    sessionTemplates: {
      toArray: vi.fn(async () => sessionTemplateRows),
      get: vi.fn(async (id: string) => sessionTemplateRows.find((row) =>
        (row as { id?: string }).id === id)),
      put: vi.fn(async (row: unknown) => {
        sessionTemplateRows = putRowById(sessionTemplateRows, row)
      }),
      bulkPut: vi.fn(async (rows: unknown[]) => {
        sessionTemplateRows = mergeRowsById(sessionTemplateRows, rows)
      }),
      clear: vi.fn(async () => {
        sessionTemplateRows = []
      }),
    },
    transaction: vi.fn(async (...args: unknown[]) => {
      const run = args.at(-1) as () => Promise<unknown>
      return run()
    }),
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
    athleteCoachNoteRows = []
    athleteMembershipRows = []
    athleteRows = []
    planGenerationJobRows = []
    readinessDailyRows = []
    whoopWorkoutRows = []
    sessionTemplateRows = []
    tableResults = new Map()
    actionResults = new Map()
    upsertCalls.length = 0
    insertCalls.length = 0
    deleteCalls.length = 0
    updateCalls.length = 0
    selectCalls.length = 0
    selectHooks.clear()
    upsertHooks.clear()
    localStorageState.clear()
    syncStatusMock.mockReset()
    syncDetailsMock.mockReset()
    getSessionMock.mockReset()
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'supabase-token' } } })
    whoopDeleteFetchMock.mockReset()
    whoopDeleteFetchMock.mockResolvedValue({ ok: true, status: 200 } as Response)
    clearAllLocalAppDataMock.mockReset()
    supabaseMock.from = createSupabaseFrom()
    supabaseMock.rpc.mockReset()
    supabaseMock.rpc.mockResolvedValue({ data: true, error: null })
    supabaseMock.auth.getSession = getSessionMock
    storeState.user = { id: 'user-1' }
    storeState.syncDetails = createSyncDetailsState()

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        get length() {
          return localStorageState.size
        },
        key: (index: number) => [...localStorageState.keys()][index] ?? null,
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

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: whoopDeleteFetchMock,
    })
  })

  // Una cuenta ya bootstrapeada siempre tiene atleta self. Sin él, toda
  // escritura sobre una tabla scoped se rechaza a propósito: una fila sin
  // `athlete_id` es inalcanzable en cuanto la membresía sea la única autoridad
  // de RLS (ver athleteScopeWriteGuard.test.ts). Los tests que quieren
  // ejercitar el estado sin scope lo ponen en null explícitamente.
  beforeEach(async () => {
    const { setSelfAthleteId } = await import('../athlete/activeAthlete')
    setSelfAthleteId('ath_user-1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  describe('pullWeekSessionsForAthlete', () => {
    const remoteSession = (
      id: string,
      athleteId: string | null,
      updatedAt: number,
      title = id,
    ) => ({
      id,
      user_id: 'user-1',
      athlete_id: athleteId,
      date: '2026-07-14',
      time_block: 'am',
      type: 'squash',
      status: 'planned',
      created_at: 1,
      updated_at: updatedAt,
      data: { title, durationMin: 60 },
    })

    it('aplica scope y rango del atleta gestionado y conserva LWW local', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      sessionsRows = [
        {
          id: 'local-newer',
          athleteId: 'ath-managed',
          date: '2026-07-14',
          timeBlock: 'am',
          type: 'squash',
          status: 'planned',
          title: 'Local más nueva',
          durationMin: 60,
          createdAt: 1,
          updatedAt: 200,
        },
      ]
      tableResults.set('sessions', {
        data: [
          remoteSession('remote-new', 'ath-managed', 300, 'Remota nueva'),
          remoteSession('local-newer', 'ath-managed', 100, 'Remota vieja'),
        ],
        error: null,
      })

      const sync = await import('../syncService')
      const outcome = await sync.pullWeekSessionsForAthlete(
        'user-1',
        'ath-managed',
        '2026-07-13',
        '2026-07-19',
        { includeLegacy: false },
      )

      expect(selectCalls.at(-1)).toEqual({
        table: 'sessions',
        filters: [
          { op: 'gte', column: 'date', value: '2026-07-13' },
          { op: 'lte', column: 'date', value: '2026-07-19' },
          { op: 'eq', column: 'athlete_id', value: 'ath-managed' },
        ],
      })
      expect(sessionsRows.find((row) => (row as { id: string }).id === 'remote-new')).toMatchObject({
        athleteId: 'ath-managed',
        title: 'Remota nueva',
        updatedAt: 300,
      })
      expect(sessionsRows.find((row) => (row as { id: string }).id === 'local-newer')).toMatchObject({
        title: 'Local más nueva',
        updatedAt: 200,
      })
      expect(outcome).toBe('completed')
    })

    it('desempata updatedAt idéntico a favor de la versión remota', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      sessionsRows = [
        {
          id: 'same-version',
          athleteId: 'ath-managed',
          date: '2026-07-14',
          timeBlock: 'am',
          type: 'squash',
          status: 'planned',
          title: 'Local',
          durationMin: 60,
          createdAt: 1,
          updatedAt: 200,
        },
      ]
      tableResults.set('sessions', {
        data: [remoteSession('same-version', 'ath-managed', 200, 'Remota')],
        error: null,
      })

      const sync = await import('../syncService')
      await sync.pullWeekSessionsForAthlete(
        'user-1',
        'ath-managed',
        '2026-07-13',
        '2026-07-19',
        { includeLegacy: false },
      )

      expect(sessionsRows).toMatchObject([{ id: 'same-version', title: 'Remota', updatedAt: 200 }])
    })

    it('self includeLegacy consulta athlete_id propio o null e hidrata legacy', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      tableResults.set('sessions', {
        data: [remoteSession('legacy', null, 100, 'Legacy')],
        error: null,
      })

      const sync = await import('../syncService')
      await sync.pullWeekSessionsForAthlete(
        'user-1',
        'ath_user-1',
        '2026-07-13',
        '2026-07-19',
        { includeLegacy: true },
      )

      expect(selectCalls.at(-1)?.filters).toEqual([
        { op: 'gte', column: 'date', value: '2026-07-13' },
        { op: 'lte', column: 'date', value: '2026-07-19' },
        {
          op: 'or', column: 'or',
          value: 'athlete_id.eq.ath_user-1,and(user_id.eq.user-1,athlete_id.is.null)',
        },
      ])
      expect(sessionsRows).toHaveLength(1)
      expect(sessionsRows[0]).toMatchObject({ id: 'legacy', athleteId: undefined })
    })

    it('respeta tombstones de sesión: omite remoto viejo y acepta/limpia remoto nuevo', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      const deletedAt = Date.now()
      localStorageState.set('entrenador_sync_session_tombstones_v1', JSON.stringify({
        'user-1': {
          'remote-old': deletedAt,
          'remote-new': deletedAt,
        },
      }))
      tableResults.set('sessions', {
        data: [
          remoteSession('remote-old', 'ath-managed', deletedAt - 1),
          remoteSession('remote-new', 'ath-managed', deletedAt + 1),
        ],
        error: null,
      })

      const sync = await import('../syncService')
      const outcome = await sync.pullWeekSessionsForAthlete(
        'user-1',
        'ath-managed',
        '2026-07-13',
        '2026-07-19',
        { includeLegacy: false },
      )

      expect(sessionsRows.map((row) => (row as { id: string }).id)).toEqual(['remote-new'])
      const stored = JSON.parse(localStorageState.get('entrenador_sync_session_tombstones_v1') ?? '{}')
      expect(stored['user-1']).toEqual({ 'remote-old': deletedAt })
      expect(outcome).toBe('completed')
    })

    it('lee y parsea el mapa de tombstones de sesión una sola vez por pull', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      tableResults.set('sessions', {
        data: Array.from({ length: 50 }, (_, index) =>
          remoteSession(`remote-${index}`, 'ath-managed', 100 + index)),
        error: null,
      })
      const getItem = vi.spyOn(localStorage, 'getItem')
      const sync = await import('../syncService')

      await sync.pullWeekSessionsForAthlete(
        'user-1',
        'ath-managed',
        '2026-07-13',
        '2026-07-19',
        { includeLegacy: false },
      )

      expect(getItem.mock.calls.filter(([key]) => key === 'entrenador_sync_session_tombstones_v1'))
        .toHaveLength(1)
    })

    it('si aparece el tombstone del atleta durante el fetch no reintroduce sesiones', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      let requested = false
      let release!: (result: SupabaseResult) => void
      selectHooks.set('sessions', () => {
        requested = true
        return new Promise<SupabaseResult>((resolve) => {
          release = resolve
        })
      })

      const sync = await import('../syncService')
      const pulling = sync.pullWeekSessionsForAthlete(
        'user-1',
        'ath-managed',
        '2026-07-13',
        '2026-07-19',
        { includeLegacy: false },
      )
      await vi.waitFor(() => expect(requested).toBe(true))

      const { rememberAthleteDeleteTombstone } = await import('../sync/athleteDeleteTombstones')
      rememberAthleteDeleteTombstone('user-1', 'ath-managed')
      release({ data: [remoteSession('late', 'ath-managed', 100)], error: null })
      await expect(pulling).resolves.toBe('vetoed')

      expect(sessionsRows).toEqual([])
    })

    it('sin backend configurado retorna sin consultar ni escribir', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', '')
      tableResults.set('sessions', {
        data: [remoteSession('should-not-load', 'ath-managed', 100)],
        error: null,
      })

      const sync = await import('../syncService')
      const outcome = await sync.pullWeekSessionsForAthlete(
        'user-1',
        'ath-managed',
        '2026-07-13',
        '2026-07-19',
        { includeLegacy: false },
      )

      expect(selectCalls).toEqual([])
      expect(sessionsRows).toEqual([])
      expect(outcome).toBe('unavailable')
    })

    it('pull scoped acepta una fila vinculada con otro user_id', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      tableResults.set('sessions', {
        data: [{ ...remoteSession('linked', 'ath-linked', 100), user_id: 'linked-account' }],
        error: null,
      })
      const sync = await import('../syncService')
      await expect(sync.pullWeekSessionsForAthlete(
        'owner-1', 'ath-linked', '2026-07-13', '2026-07-19', { includeLegacy: false },
      )).resolves.toBe('completed')
      expect(selectCalls.at(-1)?.filters).not.toContainEqual(
        expect.objectContaining({ column: 'user_id' }),
      )
      expect(sessionsRows).toContainEqual(expect.objectContaining({ id: 'linked', athleteId: 'ath-linked' }))
    })

    it('day log y summary reconcilian por clave natural con ids distintos', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      dayLogRows = [{
        id: 'local-day', athleteId: 'ath-managed', date: '2026-07-14', updatedAt: 200, sleepHours: 8,
      }]
      weekSummaryRows = [{
        id: 'local-week', athleteId: 'ath-managed', weekStartDate: '2026-07-13', updatedAt: 100,
        totalSessions: 1,
      }]
      tableResults.set('day_logs', {
        data: [{
          id: 'remote-day', user_id: 'linked', athlete_id: 'ath-managed', date: '2026-07-14',
          updated_at: 100, data: { sleepHours: 5 },
        }],
        error: null,
      })
      tableResults.set('week_summaries', {
        data: [{
          id: 'remote-week', user_id: 'linked', athlete_id: 'ath-managed',
          week_start_date: '2026-07-13', updated_at: 300, data: { totalSessions: 3 },
        }],
        error: null,
      })
      const sync = await import('../syncService')
      await expect(sync.pullWeekDayLogsForAthlete(
        'owner-1', 'ath-managed', '2026-07-13', '2026-07-19', { includeLegacy: false },
      )).resolves.toBe('completed')
      await expect(sync.pullWeekSummaryRowForAthlete(
        'owner-1', 'ath-managed', '2026-07-13', { includeLegacy: false },
      )).resolves.toBe('completed')
      expect(dayLogRows).toEqual([expect.objectContaining({ id: 'local-day', sleepHours: 8 })])
      expect(weekSummaryRows).toEqual([
        expect.objectContaining({ id: 'remote-week', athleteId: 'ath-managed', totalSessions: 3 }),
      ])
    })
  })

  describe('athlete write leases', () => {
    it('la barrera es exclusiva por atleta y su release es idempotente', async () => {
      const sync = await import('../sync/athleteWriteLease')
      const releaseA = sync.acquireAthleteDeletionBarrier('ath-a')
      const releaseB = sync.acquireAthleteDeletionBarrier('ath-b')

      expect(releaseA).not.toBeNull()
      expect(releaseB).not.toBeNull()
      expect(sync.acquireAthleteDeletionBarrier('ath-a')).toBeNull()

      releaseA?.()
      releaseA?.()
      const releaseAgain = sync.acquireAthleteDeletionBarrier('ath-a')
      expect(releaseAgain).not.toBeNull()
      releaseAgain?.()
      releaseB?.()
    })

    it('registra el lease antes de ejecutar y waitForInFlightAthleteOps espera su final', async () => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const run = vi.fn(async () => gate)
      const sync = await import('../sync/athleteWriteLease')

      const write = sync.withAthleteWriteLease('ath-managed', run)
      expect(write).not.toBeNull()

      let waitResolved = false
      const waiting = sync.waitForInFlightAthleteOps('ath-managed').then(() => {
        waitResolved = true
      })
      await Promise.resolve()
      expect(run).toHaveBeenCalledOnce()
      expect(waitResolved).toBe(false)

      release()
      await Promise.all([write, waiting])
      expect(waitResolved).toBe(true)
    })

    it('un tombstone visible veta el lease antes de iniciar run', async () => {
      const { rememberAthleteDeleteTombstone } = await import('../sync/athleteDeleteTombstones')
      rememberAthleteDeleteTombstone('user-1', 'ath-managed')
      const run = vi.fn(async () => undefined)
      const sync = await import('../sync/athleteWriteLease')

      expect(sync.withAthleteWriteLease('ath-managed', run)).toBeNull()
      await Promise.resolve()
      expect(run).not.toHaveBeenCalled()
    })

    it('el lease plural se registra para todos los atletas y cualquiera tombstoned veta el batch', async () => {
      const sync = await import('../sync/athleteWriteLease')
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const write = sync.withAthleteWriteLeases(['ath-a', 'ath-a', 'ath-b'], async () => gate)
      expect(write).not.toBeNull()

      let waitedA = false
      let waitedB = false
      const waits = [
        sync.waitForInFlightAthleteOps('ath-a').then(() => { waitedA = true }),
        sync.waitForInFlightAthleteOps('ath-b').then(() => { waitedB = true }),
      ]
      await Promise.resolve()
      expect([waitedA, waitedB]).toEqual([false, false])
      release()
      await Promise.all([write, ...waits])

      const { rememberAthleteDeleteTombstone } = await import('../sync/athleteDeleteTombstones')
      rememberAthleteDeleteTombstone('user-1', 'ath-b')
      const vetoedRun = vi.fn(async () => undefined)
      expect(sync.withAthleteWriteLeases(['ath-a', 'ath-b'], vetoedRun)).toBeNull()
      expect(vetoedRun).not.toHaveBeenCalled()
    })

    it('el drain registra un upsert de athletes por payload.id aunque no tenga athlete_id', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([{
        userId: 'user-1',
        table: 'athletes',
        action: 'upsert',
        payload: { id: 'ath-managed', owner_account_id: 'user-1', status: 'active' },
        enqueuedAt: Date.now(),
      }]))
      let requested = false
      let release!: (result: SupabaseResult) => void
      upsertHooks.set('athletes', () => {
        requested = true
        return new Promise<SupabaseResult>((resolve) => { release = resolve })
      })
      const sync = await import('../syncService')

      const draining = sync.drainQueue()
      await vi.waitFor(() => expect(requested).toBe(true))
      let waited = false
      const waiting = sync.waitForInFlightAthleteOps('ath-managed').then(() => { waited = true })
      await Promise.resolve()
      expect(waited).toBe(false)

      release({ data: null, error: null })
      await Promise.all([draining, waiting])
      expect(waited).toBe(true)
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })
  })

  describe('session target sync', () => {
    const targetSession = (athleteId?: string) => ({
      id: 'session-target', athleteId, date: '2026-07-14', timeBlock: 'AM',
      type: 'squash', status: 'planned', title: 'Target', durationMin: 60,
      source: 'coach', authoredByRole: 'coach', createdAt: 1, updatedAt: 10,
    }) as const

    it('push scoped actualiza por id+athlete_id sin user_id', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      actionResults.set('update:sessions', { data: [{ id: 'session-target' }], error: null })
      const sync = await import('../syncService')
      await sync.pushSessionForTarget(
        targetSession('ath-managed') as never,
        { kind: 'scoped', athleteId: 'ath-managed' },
      )
      expect(updateCalls.at(-1)?.filters).toEqual([
        { op: 'eq', column: 'id', value: 'session-target' },
        { op: 'eq', column: 'athlete_id', value: 'ath-managed' },
      ])
      expect(updateCalls.at(-1)?.payload).toMatchObject({
        id: 'session-target', athlete_id: 'ath-managed', updated_by_account_id: 'user-1',
      })
      expect(updateCalls.at(-1)?.payload).not.toHaveProperty('user_id')
    })

    it('push legacy adopta localmente sin pisar edits concurrentes', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      sessionsRows = [{ ...targetSession(), title: 'Edit local', updatedAt: 99 }]
      actionResults.set('update:sessions', { data: [{ id: 'session-target' }], error: null })
      const sync = await import('../syncService')
      await sync.pushSessionForTarget(
        targetSession() as never,
        { kind: 'legacySelf', ownerAccountId: 'user-1', selfAthleteId: 'ath-self' },
      )
      expect(updateCalls.at(-1)?.filters).toEqual([
        { op: 'eq', column: 'id', value: 'session-target' },
        { op: 'eq', column: 'user_id', value: 'user-1' },
        { op: 'is', column: 'athlete_id', value: null },
      ])
      expect(sessionsRows).toContainEqual(expect.objectContaining({
        id: 'session-target', athleteId: 'ath-self', title: 'Edit local', updatedAt: 99,
      }))
    })

    it('delete legacy prueba la fila adoptada cuando no encuentra legacy', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      actionResults.set('delete:sessions', [
        { data: [], error: null },
        { data: null, error: null },
      ])
      const sync = await import('../syncService')
      await sync.deleteSessionForTarget('session-target', {
        kind: 'legacySelf', ownerAccountId: 'user-1', selfAthleteId: 'ath-self',
      })
      expect(deleteCalls).toHaveLength(2)
      expect(deleteCalls[1].filters).toEqual([
        { op: 'eq', column: 'id', value: 'session-target' },
        { op: 'eq', column: 'athlete_id', value: 'ath-self' },
      ])
    })

    it('offline encola target y clearQueuedOpsForAthlete lo suprime', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
      const sync = await import('../syncService')
      await sync.pushSessionForTarget(
        targetSession('ath-managed') as never,
        { kind: 'scoped', athleteId: 'ath-managed' },
      )
      const queued = JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')
      expect(queued).toEqual([expect.objectContaining({
        table: 'sessions', action: 'upsert', scopeAthleteId: 'ath-managed',
        sessionTarget: { kind: 'scoped', athleteId: 'ath-managed' },
      })])
      const queue = await import('../sync/syncQueue')
      queue.clearQueuedOpsForAthlete('user-1', 'ath-managed')
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })

    it('drain replays sessionTarget y consume la versión persistida', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      actionResults.set('update:sessions', { data: [{ id: 'session-target' }], error: null })
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([{
        userId: 'user-1', table: 'sessions', action: 'upsert', enqueuedAt: 10,
        payload: {
          id: 'session-target', date: '2026-07-14', time_block: 'AM', type: 'squash',
          status: 'planned', created_at: 1, updated_at: 10, data: { title: 'Target', durationMin: 60 },
        },
        scopeAthleteId: 'ath-managed',
        sessionTarget: { kind: 'scoped', athleteId: 'ath-managed' },
      }]))
      const sync = await import('../syncService')
      await expect(sync.drainQueue()).resolves.toBe(true)
      expect(updateCalls.at(-1)?.filters).toContainEqual(
        { op: 'eq', column: 'athlete_id', value: 'ath-managed' },
      )
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })
  })

  describe('drainQueue concurrent reconciliation', () => {
    const queuedSession = (id: string, title: string, enqueuedAt = 100) => ({
      userId: 'user-1',
      table: 'sessions' as const,
      action: 'upsert' as const,
      payload: { id, data: { title }, updated_at: enqueuedAt },
      enqueuedAt,
    })

    it('preserva una op encolada mientras el snapshot se está drenando', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      const blocker = queuedSession('session-a', 'A')
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([blocker]))
      let requested = false
      let release!: (result: SupabaseResult) => void
      upsertHooks.set('sessions', () => {
        requested = true
        return new Promise<SupabaseResult>((resolve) => { release = resolve })
      })
      const sync = await import('../syncService')
      const queue = await import('../sync/syncQueue')

      const draining = sync.drainQueue()
      await vi.waitFor(() => expect(requested).toBe(true))
      const concurrent = queuedSession('session-b', 'B', 101)
      queue.enqueue(concurrent)
      upsertHooks.delete('sessions')
      release({ data: null, error: null })

      await expect(draining).resolves.toBe(false)
      expect(queue.loadQueue()).toEqual([concurrent])
      expect(storeState.syncDetails.lastSuccessfulSyncAt).toBeNull()
      expect(storeState.syncDetails.lastRecoveredSyncAt).toBeNull()
      expect(storeState.syncDetails.syncAttemptInFlight).toBe(false)
    })

    it('misma identidad y enqueuedAt pero payload nuevo supersede al snapshot', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      const blocker = queuedSession('session-a', 'A')
      const oldVersion = queuedSession('session-b', 'Vieja')
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([blocker, oldVersion]))
      let requested = false
      let release!: (result: SupabaseResult) => void
      upsertHooks.set('sessions', () => {
        requested = true
        return new Promise<SupabaseResult>((resolve) => { release = resolve })
      })
      const sync = await import('../syncService')
      const queue = await import('../sync/syncQueue')

      const draining = sync.drainQueue()
      await vi.waitFor(() => expect(requested).toBe(true))
      const newVersion = queuedSession('session-b', 'Nueva')
      queue.saveQueue([blocker, newVersion])
      upsertHooks.delete('sessions')
      release({ data: null, error: null })

      await expect(draining).resolves.toBe(false)
      expect(queue.loadQueue()).toEqual([newVersion])
      const sessionUpserts = upsertCalls.filter((call) => call.table === 'sessions')
      expect(sessionUpserts).toHaveLength(1)
      expect(sessionUpserts[0]?.payload).toMatchObject({ id: 'session-a' })
    })

    it('un éxito seguido de retry usa madeProgress del snapshot', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([
        queuedSession('session-a', 'A'),
        queuedSession('session-b', 'B', 101),
      ]))
      let call = 0
      upsertHooks.set('sessions', async () => {
        call += 1
        return call === 1
          ? { data: null, error: null }
          : { data: null, error: { status: 401, message: 'JWT expired' } }
      })
      const sync = await import('../syncService')
      const queue = await import('../sync/syncQueue')

      await expect(sync.drainQueue()).resolves.toBe(false)
      expect(queue.loadQueue()).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({ id: 'session-b' }),
          retryCount: 1,
          lastErrorCategory: 'auth_error',
        }),
      ])
      expect(syncStatusMock).toHaveBeenLastCalledWith(
        'degraded',
        expect.stringContaining('sesión expiró'),
      )
      expect(storeState.syncDetails.syncAttemptInFlight).toBe(false)
    })
  })

  describe('week summary athlete-scoped sync', () => {
    const summary = (overrides: Record<string, unknown> = {}) => ({
      id: 'week-local', athleteId: 'ath-managed', weekStartDate: '2026-07-13', updatedAt: 200,
      totalSessions: 2, totalMinutes: 120, plannedSessions: 2, completedSessions: 1,
      plannedMinutes: 120, completedMinutes: 60, squashSessions: 1,
      runningSessions: 0, strengthSessions: 0, ...overrides,
    })

    beforeEach(() => {
      athleteRows = [{
        id: 'ath-managed', ownerAccountId: 'user-1', linkedAccountId: null,
        status: 'active', createdAt: 1, updatedAt: 1,
      }]
    })

    it('update-first usa id+athlete_id y no reparenta', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      actionResults.set('update:week_summaries', { data: [{ id: 'week-local' }], error: null })
      const sync = await import('../syncService')
      await sync.pushWeekSummaryForAthlete(summary() as never)
      expect(updateCalls.at(-1)?.filters).toEqual([
        { op: 'eq', column: 'id', value: 'week-local' },
        { op: 'eq', column: 'athlete_id', value: 'ath-managed' },
      ])
      expect(updateCalls.at(-1)?.payload).not.toHaveProperty('user_id')
      expect(insertCalls).toEqual([])
    })

    it('si no encuentra update inserta con user_id solo en el insert', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      actionResults.set('update:week_summaries', { data: [], error: null })
      actionResults.set('insert:week_summaries', { data: null, error: null })
      const sync = await import('../syncService')
      await sync.pushWeekSummaryForAthlete(summary() as never)
      expect(insertCalls.at(-1)?.payload).toMatchObject({
        id: 'week-local', athlete_id: 'ath-managed', user_id: 'user-1',
      })
    })

    it('un remoto más nuevo gana y se reconcilia inmediatamente en Dexie', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      weekSummaryRows = [summary()]
      actionResults.set('update:week_summaries', { data: [], error: null })
      actionResults.set('insert:week_summaries', { data: null, error: { code: '23505' } })
      actionResults.set('select:week_summaries', {
        data: [{
          id: 'week-remote', user_id: 'linked', athlete_id: 'ath-managed',
          week_start_date: '2026-07-13', updated_at: 300,
          data: { totalSessions: 5, totalMinutes: 250 },
        }],
        error: null,
      })
      const sync = await import('../syncService')
      await sync.pushWeekSummaryForAthlete(summary() as never)
      expect(weekSummaryRows).toEqual([
        expect.objectContaining({ id: 'week-remote', athleteId: 'ath-managed', totalSessions: 5 }),
      ])
      expect(selectCalls.at(-1)?.filters).toEqual([
        { op: 'eq', column: 'athlete_id', value: 'ath-managed' },
        { op: 'eq', column: 'week_start_date', value: '2026-07-13' },
      ])
    })

    it('un local más nuevo actualiza condicionalmente la fila del natural key', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      weekSummaryRows = [summary()]
      actionResults.set('update:week_summaries', [
        { data: [], error: null },
        { data: [{ id: 'week-remote' }], error: null },
      ])
      actionResults.set('insert:week_summaries', { data: null, error: { code: '23505' } })
      actionResults.set('select:week_summaries', {
        data: [{
          id: 'week-remote', athlete_id: 'ath-managed', week_start_date: '2026-07-13',
          updated_at: 100, data: { totalSessions: 1 },
        }],
        error: null,
      })
      const sync = await import('../syncService')
      await sync.pushWeekSummaryForAthlete(summary() as never)
      expect(updateCalls.at(-1)?.filters).toEqual([
        { op: 'eq', column: 'id', value: 'week-remote' },
        { op: 'eq', column: 'athlete_id', value: 'ath-managed' },
        { op: 'eq', column: 'week_start_date', value: '2026-07-13' },
        { op: 'lt', column: 'updated_at', value: 200 },
      ])
      expect(weekSummaryRows).toContainEqual(expect.objectContaining({ id: 'week-remote', updatedAt: 200 }))
    })

    it('offline encola el replay discriminado', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
      const sync = await import('../syncService')
      await sync.pushWeekSummaryForAthlete(summary() as never)
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([
        expect.objectContaining({
          table: 'week_summaries', scopeAthleteId: 'ath-managed',
          replayKind: 'weekSummaryForAthlete',
        }),
      ])
    })

    it('drain usa el executor especial y no el upsert genérico', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      actionResults.set('update:week_summaries', { data: [{ id: 'week-local' }], error: null })
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([{
        userId: 'user-1', table: 'week_summaries', action: 'upsert', enqueuedAt: 10,
        payload: {
          id: 'week-local', athlete_id: 'ath-managed', week_start_date: '2026-07-13',
          updated_at: 200, data: { totalSessions: 2 },
        },
        scopeAthleteId: 'ath-managed', replayKind: 'weekSummaryForAthlete',
      }]))
      const sync = await import('../syncService')
      await expect(sync.drainQueue()).resolves.toBe(true)
      expect(updateCalls.at(-1)?.table).toBe('week_summaries')
      expect(upsertCalls.some((call) => call.table === 'week_summaries')).toBe(false)
    })

    it('drain programa retry si el replay de summary sigue retenido', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      actionResults.set('update:week_summaries', { data: [], error: null })
      actionResults.set('insert:week_summaries', { data: null, error: { code: '23505' } })
      actionResults.set('select:week_summaries', [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ])
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([{
        userId: 'user-1', table: 'week_summaries', action: 'upsert', enqueuedAt: 10,
        payload: {
          id: 'week-local', athlete_id: 'ath-managed', week_start_date: '2026-07-13',
          updated_at: 200, data: { totalSessions: 2 },
        },
        scopeAthleteId: 'ath-managed', replayKind: 'weekSummaryForAthlete',
      }]))
      const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      const sync = await import('../syncService')
      const queue = await import('../sync/syncQueue')

      await expect(sync.drainQueue()).resolves.toBe(false)

      expect(queue.loadQueue()).toEqual([
        expect.objectContaining({
          replayKind: 'weekSummaryForAthlete',
          retryCount: 1,
        }),
      ])
      expect(storeState.syncDetails.retryScheduledAt).toEqual(expect.any(Number))
      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), expect.any(Number))
      const timer = timeoutSpy.mock.results.at(-1)?.value as ReturnType<typeof setTimeout> | undefined
      if (timer !== undefined) clearTimeout(timer)
      timeoutSpy.mockRestore()
    })
  })

  describe('athlete delete drain and membership pull', () => {
    it('drena el delete canónico por owner_account_id y deja un tombstone durable', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([{
        userId: 'user-1',
        table: 'athletes',
        action: 'delete',
        payload: { id: 'ath-managed' },
        enqueuedAt: Date.now(),
      }]))
      const sync = await import('../syncService')

      await expect(sync.drainQueue()).resolves.toBe(true)

      expect(deleteCalls).toContainEqual({
        table: 'athletes',
        filters: [
          { op: 'eq', column: 'id', value: 'ath-managed' },
          { op: 'eq', column: 'owner_account_id', value: 'user-1' },
        ],
      })
      expect(deleteCalls.at(-1)?.filters.some((filter) => filter.column === 'user_id')).toBe(false)
      const tombstones = await import('../sync/athleteDeleteTombstones')
      expect(tombstones.hasAthleteDeleteTombstone('user-1', 'ath-managed')).toBe(true)
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })

    it('filtra solo la membership tombstoned y refresca el resto del cache', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      athleteMembershipRows = [{
        athleteId: 'ath-existing',
        accountId: 'user-1',
        role: 'coach',
        createdAt: 1,
        updatedAt: 1,
      }]
      tableResults.set('athlete_memberships', {
        data: [
          { athlete_id: 'ath-a', account_id: 'user-1', role: 'coach', created_at: 2, updated_at: 2 },
          { athlete_id: 'ath-b', account_id: 'user-1', role: 'coach', created_at: 2, updated_at: 2 },
        ],
        error: null,
      })
      const tombstones = await import('../sync/athleteDeleteTombstones')
      tombstones.rememberAthleteDeleteTombstone('user-1', 'ath-b')
      const sync = await import('../syncService')

      await sync.pullMemberships('user-1')

      expect(athleteMembershipRows).toEqual([expect.objectContaining({ athleteId: 'ath-a' })])
    })

    it('descarta una session_completion legacy al resolver su atleta desde la sesión local', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      sessionsRows = [{ id: 's-legacy-completion', athleteId: 'ath-managed' }]
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([{
        userId: 'user-1',
        table: 'sessions',
        action: 'session_completion',
        payload: { p_session_id: 's-legacy-completion' },
        enqueuedAt: Date.now(),
      }]))
      const tombstones = await import('../sync/athleteDeleteTombstones')
      tombstones.rememberAthleteDeleteTombstone('user-1', 'ath-managed')
      const sync = await import('../syncService')

      await expect(sync.drainQueue()).resolves.toBe(true)

      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })

    it('no consulta Dexie para session_completion legacy cuando no hay tombstones de atleta', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      sessionsRows = [{ id: 's-legacy-completion', athleteId: 'ath-managed' }]
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([{
        userId: 'user-1',
        table: 'sessions',
        action: 'session_completion',
        payload: { p_session_id: 's-legacy-completion' },
        enqueuedAt: Date.now(),
      }]))
      const { db } = await import('../../db/db')
      const getSession = vi.mocked(db.sessions.get)
      getSession.mockClear()
      const sync = await import('../syncService')

      await expect(sync.drainQueue()).resolves.toBe(true)

      expect(getSession).not.toHaveBeenCalled()
      expect(supabaseMock.rpc).toHaveBeenCalledWith('mark_session_done', expect.any(Object))
    })
  })

  describe('deleteManagedAthleteRemote', () => {
    it('sin tombstone falla antes de tocar red o cola', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      const sync = await import('../syncService')

      await expect(sync.deleteManagedAthleteRemote('user-1', 'ath-managed')).resolves.toBe('failed')
      expect(deleteCalls).toEqual([])
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })

    it('online elimina por id+owner y no altera el tombstone del caller', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      const tombstones = await import('../sync/athleteDeleteTombstones')
      const token = tombstones.rememberAthleteDeleteTombstone('user-1', 'ath-managed')
      const key = `entrenador_athlete_delete_tombstone_v1:user-1:ath-managed:${token}`
      const sync = await import('../syncService')

      await expect(sync.deleteManagedAthleteRemote('user-1', 'ath-managed')).resolves.toBe('deleted')
      expect(deleteCalls).toContainEqual({
        table: 'athletes',
        filters: [
          { op: 'eq', column: 'id', value: 'ath-managed' },
          { op: 'eq', column: 'owner_account_id', value: 'user-1' },
        ],
      })
      expect(localStorageState.get(key)).toBe('1')
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })

    it('offline persiste el delete canónico y conserva el tombstone', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { onLine: false },
      })
      const tombstones = await import('../sync/athleteDeleteTombstones')
      const token = tombstones.rememberAthleteDeleteTombstone('user-1', 'ath-managed')
      const key = `entrenador_athlete_delete_tombstone_v1:user-1:ath-managed:${token}`
      const sync = await import('../syncService')

      await expect(sync.deleteManagedAthleteRemote('user-1', 'ath-managed')).resolves.toBe('durably_queued')
      expect(deleteCalls).toEqual([])
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([
        expect.objectContaining({
          userId: 'user-1',
          table: 'athletes',
          action: 'delete',
          payload: { id: 'ath-managed' },
        }),
      ])
      expect(localStorageState.get(key)).toBe('1')
    })

    it('un error remoto no retriable falla sin encolar y conserva el tombstone', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      actionResults.set('delete:athletes', {
        data: null,
        error: { message: 'invalid request', status: 400 },
      })
      const tombstones = await import('../sync/athleteDeleteTombstones')
      const token = tombstones.rememberAthleteDeleteTombstone('user-1', 'ath-managed')
      const key = `entrenador_athlete_delete_tombstone_v1:user-1:ath-managed:${token}`
      const sync = await import('../syncService')

      await expect(sync.deleteManagedAthleteRemote('user-1', 'ath-managed')).resolves.toBe('failed')
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
      expect(localStorageState.get(key)).toBe('1')
    })

    it('un error remoto retriable persiste el delete canónico verificado', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      actionResults.set('delete:athletes', {
        data: null,
        error: { message: 'network down', status: 503 },
      })
      const tombstones = await import('../sync/athleteDeleteTombstones')
      tombstones.rememberAthleteDeleteTombstone('user-1', 'ath-managed')
      const sync = await import('../syncService')

      await expect(sync.deleteManagedAthleteRemote('user-1', 'ath-managed')).resolves.toBe('durably_queued')
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([
        expect.objectContaining({
          userId: 'user-1',
          table: 'athletes',
          action: 'delete',
          payload: { id: 'ath-managed' },
        }),
      ])
    })

    it('si localStorage ignora silenciosamente la cola devuelve failed', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { onLine: false },
      })
      const tombstones = await import('../sync/athleteDeleteTombstones')
      tombstones.rememberAthleteDeleteTombstone('user-1', 'ath-managed')
      const durableSetItem = localStorage.setItem.bind(localStorage)
      vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
        if (key === 'entrenador_sync_queue_v1') return
        durableSetItem(key, value)
      })
      const sync = await import('../syncService')

      await expect(sync.deleteManagedAthleteRemote('user-1', 'ath-managed')).resolves.toBe('failed')
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
      expect(tombstones.hasAthleteDeleteTombstone('user-1', 'ath-managed')).toBe(true)
    })
  })

  it('deletes week summaries remotely by id', async () => {
    const sync = await import('../syncService')

    await sync.deleteWeekSummaries([])
    expect(deleteCalls).toHaveLength(0)

    await sync.deleteWeekSummaries(['week-1', 'week-2'])

    expect(deleteCalls).toEqual([
      {
        table: 'week_summaries',
        filters: [
          { op: 'eq', column: 'id', value: 'week-1' },
          { op: 'eq', column: 'user_id', value: 'user-1' },
        ],
      },
      {
        table: 'week_summaries',
        filters: [
          { op: 'eq', column: 'id', value: 'week-2' },
          { op: 'eq', column: 'user_id', value: 'user-1' },
        ],
      },
    ])
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

    const migrationError = await syncService.migrateLocalDataToCloud('user-1').catch((error: unknown) => error)
    expect(migrationError).toMatchObject({
      name: 'MigrationPartialFailure',
      message: 'Migration partial failure: sessions',
      failures: [{ table: 'sessions', error: { message: 'jwt expired', status: 401 } }],
    })
    expect(storeState.syncDetails).toMatchObject({
      lastBlockedTable: 'sessions',
      lastErrorCategory: 'auth_error',
    })
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
    expect(weekSummaryUpsert?.options).toEqual({ onConflict: 'athlete_id,week_start_date' })
  })

  it('coalesces legacy and scoped week summaries before the initial bulk migration', async () => {
    weekSummaryRows = [
      {
        id: 'legacy-week',
        weekStartDate: '2026-04-06',
        updatedAt: 100,
        totalSessions: 1,
        totalMinutes: 45,
        plannedSessions: 1,
        completedSessions: 0,
        plannedMinutes: 45,
        completedMinutes: 0,
        squashSessions: 0,
        runningSessions: 1,
        strengthSessions: 0,
      },
      {
        id: 'scoped-week',
        athleteId: 'ath_user-1',
        weekStartDate: '2026-04-06',
        updatedAt: 200,
        totalSessions: 2,
        totalMinutes: 90,
        plannedSessions: 2,
        completedSessions: 1,
        plannedMinutes: 90,
        completedMinutes: 45,
        squashSessions: 1,
        runningSessions: 1,
        strengthSessions: 0,
      },
    ]

    const syncService = await import('../syncService')
    await syncService.migrateLocalDataToCloud('user-1')

    // La ruta real llama a ensureRemoteAthlete → backfill antes del bulk-upsert.
    // Para no borrar datos ni violar el índice Dexie v14, la fila legacy queda
    // sin scope; el payload de migración la coalesce de forma determinista.
    expect(weekSummaryRows.find((row) => row.id === 'legacy-week')).not.toHaveProperty('athleteId')
    expect(weekSummaryRows).toContainEqual(expect.objectContaining({
      id: 'scoped-week', athleteId: 'ath_user-1',
    }))
    const weekSummaryUpsert = upsertCalls.find((call) => call.table === 'week_summaries')
    expect(weekSummaryUpsert?.payload).toEqual([
      expect.objectContaining({
        id: 'scoped-week',
        athlete_id: 'ath_user-1',
        week_start_date: '2026-04-06',
        updated_at: 200,
      }),
    ])
  })

  it('coalesces legacy and scoped day logs before the initial bulk migration', async () => {
    dayLogRows = [
      {
        id: 'legacy-day',
        date: '2026-04-06',
        updatedAt: 100,
        sleepHours: 6,
      },
      {
        id: 'scoped-day',
        athleteId: 'ath_user-1',
        date: '2026-04-06',
        updatedAt: 200,
        sleepHours: 8,
      },
    ]

    const syncService = await import('../syncService')
    await syncService.migrateLocalDataToCloud('user-1')

    expect(dayLogRows.find((row) => row.id === 'legacy-day')).not.toHaveProperty('athleteId')
    expect(dayLogRows).toContainEqual(expect.objectContaining({
      id: 'scoped-day', athleteId: 'ath_user-1',
    }))
    const dayLogUpsert = upsertCalls.find((call) => call.table === 'day_logs')
    expect(dayLogUpsert?.payload).toEqual([
      expect.objectContaining({
        id: 'scoped-day',
        athlete_id: 'ath_user-1',
        date: '2026-04-06',
        updated_at: 200,
      }),
    ])
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

    expect(upsertCalls.find((call) => call.table === 'day_logs')?.options).toEqual({ onConflict: 'athlete_id,date' })
    expect(upsertCalls.find((call) => call.table === 'week_summaries')?.options).toEqual({ onConflict: 'athlete_id,week_start_date' })
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
      expect(profileUpsert?.options).toMatchObject({ onConflict: 'athlete_id' })
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
      expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    } finally {
      setActiveAthleteId(null)
      setSelfAthleteId(null)
    }
  })

  it('descarta una op encolada de un gestionado inexistente localmente', async () => {
    const { setSelfAthleteId } = await import('../athlete/activeAthlete')
    setSelfAthleteId('ath_user-1')
    localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([
      {
        table: 'day_logs',
        action: 'upsert',
        userId: 'user-1',
        enqueuedAt: 1,
        payload: {
          id: 'dl-ghost',
          user_id: 'user-1',
          date: '2026-07-06',
          updated_at: 10,
          athlete_id: 'ath_ghost',
        },
      },
    ]))

    try {
      const syncService = await import('../syncService')
      const drained = await syncService.drainQueue()

      expect(drained).toBe(true)
      expect(upsertCalls.find((call) => call.table === 'athletes')).toBeUndefined()
      expect(upsertCalls.find((call) => call.table === 'day_logs')).toBeUndefined()
      expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    } finally {
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

  it('conserva y reintenta un perfil gestionado cuando su push expira y el pull remoto sigue vacío', async () => {
    const { setSelfAthleteId, setActiveAthleteId } = await import('../athlete/activeAthlete')
    const { db: mockedDb } = await import('../../db/db')
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_m_pending')
    try {
      await mockedDb.athletes.put({
        id: 'ath_m_pending',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        status: 'active',
        createdAt: 50,
        updatedAt: 50,
      } as never)
      const localProfile = {
        id: 'ath_m_pending',
        athleteId: 'ath_m_pending',
        updatedAt: 100,
        name: 'Cliente pendiente',
        primarySport: 'squash',
      }
      await mockedDb.athleteProfiles.put(localProfile as never)

      actionResults.set('upsert:athlete_profiles', {
        data: null,
        error: { message: 'Failed to fetch' },
      })

      const syncService = await import('../syncService')
      await syncService.pushAthleteProfile(localProfile as never)

      const queued = JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]') as Array<{
        table: string
        retryCount?: number
      }>
      expect(queued).toHaveLength(1)
      expect(queued[0]?.table).toBe('athlete_profiles')
      queued[0]!.retryCount = 5
      localStorage.setItem('entrenador_sync_queue_v1', JSON.stringify(queued))

      expect(await syncService.drainQueue()).toBe(false)
      expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')).toEqual([])

      // Un sync exitoso posterior de otras entidades no convierte la ausencia
      // remota del perfil en una señal de borrado.
      storeState.syncDetails.lastSuccessfulSyncAt = 200
      actionResults.delete('upsert:athlete_profiles')
      actionResults.set('select:athlete_profiles', { data: [], error: null })
      await syncService.runFullSync('user-1')

      expect(athleteProfileRows.find((profile) =>
        (profile as { id?: string }).id === 'ath_m_pending',
      )).toMatchObject(localProfile)
      expect(upsertCalls.filter((call) =>
        call.table === 'athlete_profiles'
        && (call.payload as { id?: string }).id === 'profile:user-1:ath_m_pending',
      )).toHaveLength(2)
    } finally {
      setSelfAthleteId(null)
      setActiveAthleteId(null)
    }
  })

  it('un hard delete en otro dispositivo elimina la identidad y no resucita su perfil', async () => {
    const { setSelfAthleteId, setActiveAthleteId } = await import('../athlete/activeAthlete')
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_m_deleted_elsewhere')
    try {
      tableResults.set('athletes', {
        data: [{
          id: 'ath_m_deleted_elsewhere',
          owner_account_id: 'user-1',
          linked_account_id: null,
          display_name: 'Cliente remoto',
          status: 'archived',
          created_at: 10,
          updated_at: 20,
        }],
        error: null,
      })
      actionResults.set('select:athlete_profiles', {
        data: [{
          id: 'profile:user-1:ath_m_deleted_elsewhere',
          user_id: 'user-1',
          athlete_id: 'ath_m_deleted_elsewhere',
          coach_memory: null,
          updated_at: 20,
          data: { name: 'Cliente remoto', primarySport: 'squash' },
        }],
        error: null,
      })

      const syncService = await import('../syncService')
      await syncService.runFullSync('user-1')
      expect(athleteRows.find((row) => row.id === 'ath_m_deleted_elsewhere')).toBeDefined()
      expect(athleteProfileRows.find((row) =>
        (row as { id?: string }).id === 'ath_m_deleted_elsewhere',
      )).toBeDefined()
      sessionsRows = [{
        id: 'session-deleted-elsewhere',
        athleteId: 'ath_m_deleted_elsewhere',
        date: '2026-08-13',
        updatedAt: 20,
      }]
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { localStorage },
      })
      localStorage.setItem(
        'coach_chat_session_id:ath_m_deleted_elsewhere',
        'chat-session-deleted-elsewhere',
      )

      // Dispositivo A ejecutó el hard delete. La FK remota hizo cascade del
      // perfil; el segundo pull de B recibe ausencia en ambas tablas.
      tableResults.set('athletes', { data: [], error: null })
      actionResults.set('select:athlete_profiles', { data: [], error: null })
      localStorage.setItem('entrenador_sync_queue_v1', JSON.stringify([{
        userId: 'user-1',
        table: 'athlete_profiles',
        action: 'upsert',
        payload: {
          id: 'profile:user-1:ath_m_deleted_elsewhere',
          user_id: 'user-1',
          athlete_id: 'ath_m_deleted_elsewhere',
          updated_at: 25,
          data: { name: 'Edición pendiente de B' },
        },
        enqueuedAt: Date.now(),
      }]))
      upsertCalls.length = 0
      await syncService.runFullSync('user-1')

      expect(athleteRows.find((row) => row.id === 'ath_m_deleted_elsewhere')).toBeUndefined()
      expect(athleteProfileRows.find((row) =>
        (row as { athleteId?: string }).athleteId === 'ath_m_deleted_elsewhere',
      )).toBeUndefined()
      expect(sessionsRows.find((row) =>
        (row as { athleteId?: string }).athleteId === 'ath_m_deleted_elsewhere',
      )).toBeUndefined()
      expect(localStorage.getItem('coach_chat_session_id:ath_m_deleted_elsewhere')).toBeNull()
      expect(upsertCalls.some((call) =>
        call.table === 'athletes'
        && (call.payload as { id?: string }).id === 'ath_m_deleted_elsewhere',
      )).toBe(false)
      expect(upsertCalls.some((call) =>
        call.table === 'athlete_profiles'
        && (call.payload as { athlete_id?: string }).athlete_id === 'ath_m_deleted_elsewhere',
      )).toBe(false)
      expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    } finally {
      Reflect.deleteProperty(globalThis, 'window')
      setSelfAthleteId(null)
      setActiveAthleteId(null)
    }
  })

  it('no drena una escritura child si el pull de memberships devuelve error', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
    const { setSelfAthleteId, setActiveAthleteId } = await import('../athlete/activeAthlete')
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_m_pull_guard')
    try {
      athleteRows = [{
        id: 'ath_m_pull_guard',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        status: 'active',
        createdAt: 10,
        updatedAt: 20,
      }]
      const queuedChild = {
        userId: 'user-1',
        table: 'athlete_profiles',
        action: 'upsert',
        payload: {
          id: 'profile:user-1:ath_m_pull_guard',
          user_id: 'user-1',
          athlete_id: 'ath_m_pull_guard',
          updated_at: 25,
          data: { name: 'Pendiente protegido' },
        },
        enqueuedAt: Date.now(),
      }
      localStorage.setItem('entrenador_sync_queue_v1', JSON.stringify([queuedChild]))
      actionResults.set('select:athlete_memberships', {
        data: null,
        error: { message: 'memberships unavailable', status: 503 },
      })

      const syncService = await import('../syncService')
      await syncService.runFullSync('user-1')

      expect(selectCalls.some((call) => call.table === 'athletes')).toBe(false)
      expect(upsertCalls.some((call) => (
        (call.payload as { id?: string }).id === 'ath_m_pull_guard'
        || (call.payload as { athlete_id?: string }).athlete_id === 'ath_m_pull_guard'
      ))).toBe(false)
      expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]'))
        .toEqual([queuedChild])
    } finally {
      setSelfAthleteId(null)
      setActiveAthleteId(null)
    }
  })

  it('no drena una escritura child si el pull de athletes devuelve error', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
    const { setSelfAthleteId, setActiveAthleteId } = await import('../athlete/activeAthlete')
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_m_pull_guard')
    try {
      athleteRows = [{
        id: 'ath_m_pull_guard',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        status: 'active',
        createdAt: 10,
        updatedAt: 20,
      }]
      const queuedChild = {
        userId: 'user-1',
        table: 'athlete_profiles',
        action: 'upsert',
        payload: {
          id: 'profile:user-1:ath_m_pull_guard',
          user_id: 'user-1',
          athlete_id: 'ath_m_pull_guard',
          updated_at: 25,
          data: { name: 'Pendiente protegido' },
        },
        enqueuedAt: Date.now(),
      }
      localStorage.setItem('entrenador_sync_queue_v1', JSON.stringify([queuedChild]))
      actionResults.set('select:athletes', {
        data: null,
        error: { message: 'athletes unavailable', status: 503 },
      })

      const syncService = await import('../syncService')
      await syncService.runFullSync('user-1')

      expect(selectCalls.some((call) => call.table === 'athletes')).toBe(true)
      expect(upsertCalls.some((call) => (
        (call.payload as { id?: string }).id === 'ath_m_pull_guard'
        || (call.payload as { athlete_id?: string }).athlete_id === 'ath_m_pull_guard'
      ))).toBe(false)
      expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]'))
        .toEqual([queuedChild])
    } finally {
      setSelfAthleteId(null)
      setActiveAthleteId(null)
    }
  })

  it('falla cerrado si no puede persistir el tombstone del delete remoto confirmado', async () => {
    const { setSelfAthleteId, setActiveAthleteId } = await import('../athlete/activeAthlete')
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_m_guarded')
    try {
      athleteRows = [{
        id: 'ath_m_guarded',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        displayName: 'Cliente protegido',
        status: 'archived',
        createdAt: 10,
        updatedAt: 20,
      }]
      athleteProfileRows = [{
        id: 'ath_m_guarded',
        athleteId: 'ath_m_guarded',
        updatedAt: 20,
        name: 'Cliente protegido',
      }]
      sessionsRows = [{ id: 'session-guarded', athleteId: 'ath_m_guarded', updatedAt: 20 }]
      localStorage.setItem(
        'entrenador_remote_athlete_ack_v1:user-1',
        JSON.stringify(['ath_m_guarded']),
      )
      localStorage.setItem('entrenador_sync_queue_v1', JSON.stringify([{
        userId: 'user-1',
        table: 'athlete_profiles',
        action: 'upsert',
        payload: {
          id: 'profile:user-1:ath_m_guarded',
          user_id: 'user-1',
          athlete_id: 'ath_m_guarded',
          updated_at: 25,
          data: { name: 'Pendiente protegido' },
        },
        enqueuedAt: Date.now(),
      }]))
      tableResults.set('athletes', { data: [], error: null })
      actionResults.set('select:athlete_profiles', { data: [], error: null })

      const durableSetItem = localStorage.setItem.bind(localStorage)
      vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
        if (key.startsWith('entrenador_athlete_delete_tombstone_v1:user-1:ath_m_guarded:')) {
          throw new Error('quota')
        }
        durableSetItem(key, value)
      })

      const syncService = await import('../syncService')
      await syncService.runFullSync('user-1')

      expect(athleteRows.find((row) => row.id === 'ath_m_guarded')).toBeDefined()
      expect(athleteProfileRows.find((row) =>
        (row as { athleteId?: string }).athleteId === 'ath_m_guarded',
      )).toBeDefined()
      expect(sessionsRows.find((row) =>
        (row as { athleteId?: string }).athleteId === 'ath_m_guarded',
      )).toBeDefined()
      expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')).toHaveLength(1)
      expect(localStorage.getItem('entrenador_remote_athlete_ack_v1:user-1'))
        .toBe(JSON.stringify(['ath_m_guarded']))
      expect(upsertCalls.some((call) =>
        (call.payload as { id?: string }).id === 'ath_m_guarded'
        || (call.payload as { athlete_id?: string }).athlete_id === 'ath_m_guarded',
      )).toBe(false)
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
      'session_templates',
    ])
    expect(whoopDeleteFetchMock).toHaveBeenCalledWith('/.netlify/functions/whoop-sync', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer supabase-token' },
    })
    expect(updateCalls.some((call) => call.table === 'athlete_profiles')).toBe(false)
    expect(upsertCalls.some((call) => call.table === 'athlete_profiles')).toBe(true)
    expect(insertCalls.some((call) => call.table === 'athlete_profiles')).toBe(false)
    expect(deleteCalls.find((call) => call.table === 'athletes')).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    expect(localStorage.getItem('entrenador_profile_reset_lock_v1')).toContain('awaiting_bootstrap_ack')
    expect(outcome.completed).toBe(true)
    expect(outcome.pending).toEqual([])
  })

  it('does not block a full reset when the WHOOP delete function is not deployed yet', async () => {
    whoopDeleteFetchMock.mockResolvedValue({ ok: false, status: 404 } as Response)

    const syncService = await import('../syncService')
    const outcome = await syncService.wipeRemoteAndLocalAppData('user-1')

    expect(whoopDeleteFetchMock).toHaveBeenCalled()
    expect(outcome.completed).toBe(true)
    expect(outcome.pending).toEqual([])
    expect(clearAllLocalAppDataMock).toHaveBeenCalled()
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
    expect(athleteDelete).toBeUndefined()
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

    const sessionUpserts = upsertCalls.filter((call) => call.table === 'sessions')
    expect(sessionUpserts).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    // `upsertCalls[0]` ya no sirve: `ensureRemoteAthlete` escribe `athletes` antes.
    expect((sessionUpserts[0]?.payload as Record<string, unknown>).updated_at).toBe(20)
  })

  // `ensureRemoteAthlete` corre antes del upsert scoped, así que un solo
  // microtask ya no alcanza para observar la primera escritura en vuelo.
  const flushAsync = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

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
          // Sólo la primera escritura de `sessions` queda en vuelo:
          // `ensureRemoteAthlete` escribe `athletes` antes y también cuenta.
          if (upsertCalls.filter((call) => call.table === 'sessions').length === 1) {
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

    await flushAsync()

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

    await flushAsync()

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

  it('preserva pendingRecalibration (campo local-only del plan) cuando el remoto gana el LWW', async () => {
    // Regresión: mergeTrainingPlans pisaba el plan local COMPLETO con
    // rowToTrainingPlan(row) cuando el remoto era más nuevo. Ese mapeo nunca
    // conoce pendingRecalibration (planRows.ts no lo mapea a ninguna
    // columna a propósito, ver su JSDoc), así que el marcador de
    // recuperación de una recalibración pendiente se borraba en silencio
    // justo en el escenario para el que existe: el job termina en el
    // servidor, el usuario reabre la app, y runFullSync corre antes de que
    // llegue a Plan Builder.
    const localPlan = {
      id: 'plan-recalibrating',
      athleteId: 'athlete-1',
      goalEventId: 'evt-1',
      status: 'active',
      title: 'Plan local desactualizado',
      startDate: '2026-04-14',
      endDate: '2026-04-20',
      totalWeeks: 1,
      phases: [],
      wizardConfig: {},
      macroSnapshot: {},
      createdAt: 1,
      updatedAt: 100,
      pendingRecalibration: { weekIndexes: [2], requestedAt: 50 },
    }
    trainingPlanRows = [localPlan]
    tableResults.set('training_plans', {
      data: [{
        id: 'plan-recalibrating',
        user_id: 'user-1',
        athlete_id: 'athlete-1',
        goal_event_id: 'evt-1',
        status: 'active',
        title: 'Plan remoto (más nuevo)',
        start_date: '2026-04-14',
        end_date: '2026-04-20',
        total_weeks: 1,
        phases: [],
        wizard_config: {},
        macro_snapshot: {},
        created_at: 1,
        updated_at: 200,
        deleted_at: null,
      }],
      error: null,
    })
    tableResults.set('training_plan_weeks', { data: [], error: null })

    const syncService = await import('../syncService')
    await syncService.runFullSync('user-1')

    const merged = trainingPlanRows.find((row) => (row as { id: string }).id === 'plan-recalibrating') as
      Record<string, unknown> | undefined
    expect(merged).toBeTruthy()
    // El marcador local-only sobrevive al merge...
    expect(merged?.pendingRecalibration).toEqual({ weekIndexes: [2], requestedAt: 50 })
    // ...y el resto de los campos del plan sí toma los valores remotos: el
    // LWW y el criterio `updatedAt` no cambiaron, sólo se conserva lo que el
    // mapeo remoto nunca conoció.
    expect(merged?.title).toBe('Plan remoto (más nuevo)')
    expect(merged?.updatedAt).toBe(200)
  })

  describe('softDeleteTrainingPlan: parent tombstone commit', () => {
    const planFixture = (overrides: Partial<TrainingPlan> = {}): TrainingPlan => ({
      id: 'plan-delete',
      athleteId: 'ath_user-1',
      goalEventId: 'event-1',
      status: 'archived',
      generationState: 'complete',
      title: 'Plan Nacional',
      startDate: '2026-06-01',
      endDate: '2026-08-15',
      totalWeeks: 2,
      phases: [],
      wizardConfig: {} as TrainingPlan['wizardConfig'],
      macroSnapshot: {} as TrainingPlan['macroSnapshot'],
      createdAt: 1,
      updatedAt: 2,
      ...overrides,
    })

    const weekFixture = (
      weekIndex: number,
      overrides: Partial<TrainingPlanWeek> = {},
    ): TrainingPlanWeek => ({
      id: `plan-delete-week-${weekIndex}`,
      athleteId: 'ath_user-1',
      planId: 'plan-delete',
      weekIndex,
      weekStartDate: weekIndex === 0 ? '2026-06-01' : '2026-06-08',
      phase: 'base',
      status: 'accepted',
      sessions: [],
      weekObjectives: [],
      targetLoadBySport: {},
      validationIssues: [],
      generationMeta: { attempts: 1 },
      createdAt: 1,
      updatedAt: 2,
      ...overrides,
    })

    it('pushed confirma el padre y luego limpia todas las semanas', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      const { softDeleteTrainingPlan } = await import('../syncService')

      await expect(softDeleteTrainingPlan(
        planFixture(),
        [weekFixture(0), weekFixture(1)],
      )).resolves.toBe('pushed')

      expect(upsertCalls
        .filter((call) => call.table.startsWith('training_'))
        .map((call) => call.table)).toEqual([
        'training_plans',
        'training_plan_weeks',
        'training_plan_weeks',
      ])
    })

    it('si falla el tombstone padre no intenta ninguna semana', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      actionResults.set('upsert:training_plans', {
        data: null,
        error: {
          code: 'PGRST205',
          message: "Could not find the table 'public.training_plans' in the schema cache",
        },
      })
      const { softDeleteTrainingPlan } = await import('../syncService')

      await expect(softDeleteTrainingPlan(planFixture(), [weekFixture(0)]))
        .resolves.toBe('failed')
      expect(upsertCalls
        .filter((call) => call.table.startsWith('training_'))
        .map((call) => call.table)).toEqual(['training_plans'])
    })

    it('si el padre queda queued no intenta semanas y conserva el commit pendiente', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      actionResults.set('upsert:training_plans', {
        data: null,
        error: { message: 'network down', status: 503 },
      })
      const { softDeleteTrainingPlan } = await import('../syncService')

      await expect(softDeleteTrainingPlan(planFixture(), [weekFixture(0)]))
        .resolves.toBe('queued')
      expect(upsertCalls
        .filter((call) => call.table.startsWith('training_'))
        .map((call) => call.table)).toEqual(['training_plans'])
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]'))
        .toEqual([expect.objectContaining({ table: 'training_plans', action: 'upsert' })])
    })

    it('si la cola no se persiste el padre no informa un commit durable', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { onLine: false },
      })
      const durableSetItem = localStorage.setItem.bind(localStorage)
      vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
        if (key === 'entrenador_sync_queue_v1') return
        durableSetItem(key, value)
      })
      const { softDeleteTrainingPlan } = await import('../syncService')

      await expect(softDeleteTrainingPlan(planFixture(), [weekFixture(0)]))
        .resolves.toBe('failed')
      expect(upsertCalls).toEqual([])
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })

    it('una limpieza child failed/queued no degrada un padre ya pushed', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      actionResults.set('upsert:training_plan_weeks', {
        data: null,
        error: { message: 'network down', status: 503 },
      })
      const { softDeleteTrainingPlan } = await import('../syncService')

      await expect(softDeleteTrainingPlan(planFixture(), [weekFixture(0)]))
        .resolves.toBe('pushed')
      expect(upsertCalls
        .filter((call) => call.table.startsWith('training_'))
        .map((call) => call.table)).toEqual([
        'training_plans',
        'training_plan_weeks',
      ])
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]'))
        .toEqual([expect.objectContaining({ table: 'training_plan_weeks', action: 'upsert' })])
    })

    it('usa un timestamp mayor que plan y semanas aunque estén en el futuro', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      const futurePlan = Date.now() + 50_000
      const futureWeek = futurePlan + 50_000
      const { softDeleteTrainingPlan } = await import('../syncService')

      await softDeleteTrainingPlan(
        planFixture({ updatedAt: futurePlan }),
        [weekFixture(0, { updatedAt: futureWeek })],
      )

      const payloads = upsertCalls
        .filter((call) => call.table.startsWith('training_'))
        .map((call) => call.payload as Record<string, unknown>)
      expect(payloads).toHaveLength(2)
      expect(payloads[0]).toMatchObject({
        updated_at: futureWeek + 1,
        deleted_at: futureWeek + 1,
      })
      expect(payloads[1]).toMatchObject({
        updated_at: futureWeek + 1,
        deleted_at: futureWeek + 1,
      })
    })

    it('plan y weeks legacy heredan el mismo athlete_id self remoto', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      const { softDeleteTrainingPlan } = await import('../syncService')

      await softDeleteTrainingPlan(
        planFixture({ athleteId: undefined as never }),
        [weekFixture(0, { athleteId: undefined })],
      )

      expect(upsertCalls
        .filter((call) => call.table.startsWith('training_'))
        .map((call) => call.payload)).toEqual([
        expect.objectContaining({ athlete_id: 'ath_user-1' }),
        expect.objectContaining({ athlete_id: 'ath_user-1' }),
      ])
    })

    it('no_remote permite borrado local sin intentar children; sin sesión remota falla', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', '')
      let sync = await import('../syncService')
      await expect(sync.softDeleteTrainingPlan(planFixture(), [weekFixture(0)]))
        .resolves.toBe('no_remote')
      expect(upsertCalls).toEqual([])

      vi.resetModules()
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      ;(storeState as { user: { id: string } | null }).user = null
      sync = await import('../syncService')
      await expect(sync.softDeleteTrainingPlan(planFixture(), [weekFixture(0)]))
        .resolves.toBe('failed')
      expect(upsertCalls).toEqual([])
    })

    it('archiveTrainingPlan nunca degrada un timestamp futuro recibido', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      const future = Date.now() + 100_000
      const { archiveTrainingPlan } = await import('../syncService')

      await archiveTrainingPlan(planFixture({ status: 'active', updatedAt: future }), [])

      const planPushes = upsertCalls.filter((call) => call.table === 'training_plans')
      expect(planPushes).toHaveLength(1)
      expect(planPushes[0]?.payload).toMatchObject({
        status: 'archived',
        updated_at: future,
      })
    })

    it('el merge del tombstone padre purga weeks y planGenerationJobs locales', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      const localPlan = planFixture({ status: 'active', updatedAt: 10 })
      trainingPlanRows = [localPlan]
      trainingPlanWeekRows = [weekFixture(0, { updatedAt: 10 })]
      planGenerationJobRows = [{
        id: 'job-plan-delete',
        planId: localPlan.id,
        athleteId: localPlan.athleteId,
        status: 'succeeded',
        updatedAt: 10,
      }]
      tableResults.set('training_plans', {
        data: [{
          id: localPlan.id,
          user_id: 'user-1',
          athlete_id: localPlan.athleteId,
          goal_event_id: localPlan.goalEventId,
          status: 'active',
          generation_state: 'complete',
          title: localPlan.title,
          start_date: localPlan.startDate,
          end_date: localPlan.endDate,
          total_weeks: localPlan.totalWeeks,
          phases: [],
          wizard_config: {},
          macro_snapshot: {},
          created_at: 1,
          updated_at: 20,
          deleted_at: 20,
        }],
        error: null,
      })
      tableResults.set('training_plan_weeks', { data: [], error: null })
      const { runFullSync } = await import('../syncService')

      await runFullSync('user-1')

      expect(trainingPlanRows).toEqual([])
      expect(trainingPlanWeekRows).toEqual([])
      expect(planGenerationJobRows).toEqual([])
    })
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
