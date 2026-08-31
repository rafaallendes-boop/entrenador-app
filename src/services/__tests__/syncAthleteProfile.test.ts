import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toAthleteProfileSyncRow } from '../syncUtils'
import type { AthleteProfileSyncRow } from '../syncUtils'

const localStorageState = new Map<string, string>()
const syncStatusMock = vi.fn()
const syncDetailsMock = vi.fn()

let athleteProfileRows: AthleteProfileSyncRow[] = []
const tableResults = new Map<string, { data: unknown; error: unknown }>()
// Separate map so tests can make upsert fail while select (fetchAthleteProfileRows) succeeds
const upsertResults = new Map<string, { data: unknown; error: unknown }>()
const upsertCalls: Array<{ table: string; payload: unknown; options?: unknown }> = []
const insertCalls: Array<{ table: string; payload: unknown }> = []
const updateCalls: Array<{ table: string; payload: unknown }> = []
const deleteCalls: Array<{ table: string; ids: string[] }> = []

function createQueryBuilder(table: string) {
  const eqFilters: Record<string, string> = {}
  const inFilters: Record<string, string[]> = {}

  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((col, val) => {
      eqFilters[col] = String(val)
      return builder
    }),
    in: vi.fn((col, vals) => {
      inFilters[col] = (vals as unknown[]).map(String)
      return builder
    }),
    then(onFulfilled: (value: { data: unknown; error: unknown }) => unknown) {
      const result = tableResults.get(table) ?? { data: null, error: null }

      if (table === 'athlete_profiles' && inFilters.id && !result.error) {
        deleteCalls.push({ table, ids: [...inFilters.id] })
        athleteProfileRows = athleteProfileRows.filter((row) => !inFilters.id.includes(row.id))
      }

      // Simulate select returning the mock rows if no error is mocked
      if (table === 'athlete_profiles' && !result.error && !result.data) {
        let filtered = [...athleteProfileRows]
        if (eqFilters['user_id']) {
          filtered = filtered.filter((row) => row.user_id === eqFilters['user_id'])
        }
        if (inFilters['id']) {
          filtered = filtered.filter((row) => inFilters['id'].includes(row.id))
        }
        return Promise.resolve(onFulfilled({ data: filtered, error: null }))
      }

      return Promise.resolve(onFulfilled(result))
    },
  }
  return builder
}

vi.mock('../auth', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      const builder = createQueryBuilder(table)
      return {
        ...builder,
        upsert: vi.fn((payload: unknown, options?: unknown) => {
          upsertCalls.push({ table, payload, options })
          return Promise.resolve(upsertResults.get(table) ?? tableResults.get(table) ?? { data: null, error: null })
        }),
        insert: vi.fn((payload: unknown) => {
          insertCalls.push({ table, payload })
          return Promise.resolve(tableResults.get(table) ?? { data: null, error: null })
        }),
        update: vi.fn((payload: unknown) => {
          updateCalls.push({ table, payload })
          return builder
        }),
        delete: vi.fn(() => builder),
      }
    }),
  },
}))

vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: {
    getState: () => ({
      user: { id: 'user-1' },
      syncDetails: {
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
      },
      setSyncStatus: syncStatusMock,
      setSyncDetails: syncDetailsMock,
    }),
  },
}))

vi.mock('../../db/db', () => ({
  db: {
    athleteProfiles: {
      toArray: vi.fn(async () => []),
      bulkPut: vi.fn(async () => {}),
      count: vi.fn(async () => 0),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    },
    athletes: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
    },
    sessions: { count: vi.fn(async () => 0), toArray: vi.fn(async () => []), bulkPut: vi.fn(async () => {}) },
    dayLogs: { count: vi.fn(async () => 0), toArray: vi.fn(async () => []), bulkPut: vi.fn(async () => {}) },
    weekSummaries: { count: vi.fn(async () => 0), toArray: vi.fn(async () => []), bulkPut: vi.fn(async () => {}) },
    chatMessages: { count: vi.fn(async () => 0), toArray: vi.fn(async () => []), bulkPut: vi.fn(async () => {}) },
    coachProposals: { count: vi.fn(async () => 0), toArray: vi.fn(async () => []), bulkPut: vi.fn(async () => {}) },
    trainingPlans: { toArray: vi.fn(async () => []), bulkPut: vi.fn(async () => {}) },
    trainingPlanWeeks: { toArray: vi.fn(async () => []), bulkPut: vi.fn(async () => {}) },
    planGenerationJobs: { toArray: vi.fn(async () => []), bulkPut: vi.fn(async () => {}) },
  },
}))

describe('Athlete Profile Sync - Hardening Fixes', () => {
  beforeEach(() => {
    // Override vite environment
    Object.defineProperty(import.meta, 'env', {
      value: {
        VITE_SUPABASE_URL: 'http://localhost:54321',
        VITE_SUPABASE_ANON_KEY: 'test-key',
      },
      writable: true,
      configurable: true,
    })
    
    athleteProfileRows = []
    tableResults.clear()
    upsertResults.clear()
    upsertCalls.length = 0
    insertCalls.length = 0
    updateCalls.length = 0
    deleteCalls.length = 0
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

    vi.stubGlobal('navigator', { onLine: true })
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('1. Syncing a new profile uses upsert with onConflict when no remote row exists', async () => {
    athleteProfileRows = [] // No remote profiles

    const syncService = await import('../syncService')
    await syncService.pushAthleteProfile({
      id: 'default',
      name: 'Rafa',
      updatedAt: 100,
    })

    // ensureRemoteAthlete now fires for the self profile too (athlete_id is
    // always non-null), so filter to the athlete_profiles calls specifically.
    const profileUpserts = upsertCalls.filter((call) => call.table === 'athlete_profiles')
    expect(profileUpserts).toHaveLength(1)
    expect(profileUpserts[0].options).toEqual({ onConflict: 'athlete_id' })
    const payload = profileUpserts[0].payload as Record<string, unknown>
    expect(payload.id).toBe('profile:user-1')
    expect(payload.user_id).toBe('user-1')
  })

  it('2. Syncing an existing profile uses update instead of insert to prevent duplicates if UPSERT is skipped', async () => {
    athleteProfileRows = [
      toAthleteProfileSyncRow({
        id: 'remote-1',
        user_id: 'user-1',
        updated_at: 50,
        data: {},
      })
    ]

    const syncService = await import('../syncService')
    await syncService.pushAthleteProfile({
      id: 'default', // local ID
      name: 'Rafa Updated',
      updatedAt: 150,
    })

    // With the new logic, the first branch checks existingRows.length.
    // If it is 1, it updates that single row.
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].table).toBe('athlete_profiles')
    const payload = updateCalls[0].payload as { data: Record<string, unknown> }
    expect(payload.data.name).toBe('Rafa Updated')
  })

  it('3. Detects remote duplicates and repairs them BEFORE pushing the new update', async () => {
    athleteProfileRows = [
      toAthleteProfileSyncRow({ id: 'legacy-1', user_id: 'user-1', updated_at: 100, data: { name: 'A' } }),
      toAthleteProfileSyncRow({ id: 'legacy-2', user_id: 'user-1', updated_at: 200, data: { name: 'B' } })
    ]

    const syncService = await import('../syncService')
    await syncService.pushAthleteProfile({
      id: 'default',
      name: 'Rafa New',
      updatedAt: 300,
    })

    // The repair function should have picked the newer locally provided row (300) to win,
    // updated legacy-1 or legacy-2 to the new data, and deleted the rest.
    // legacy-2 was the previous highest updated_at, but we provided a new row with 300.
    // The preferredRow will have updated_at 300 and win.
    
    // Check update was called for the keeper
    expect(updateCalls.length).toBeGreaterThan(0)
    const updatePayload = updateCalls[0].payload as { data: Record<string, unknown> }
    expect(updatePayload.data.name).toBe('Rafa New')
    expect(deleteCalls).toEqual([{ table: 'athlete_profiles', ids: ['legacy-2'] }])

    // The repair function sets autoRepairInProgress flag
    expect(syncDetailsMock).toHaveBeenCalledWith(expect.objectContaining({
      autoRepairInProgress: true,
    }))
  })

  it('4. Schema mismatch (42P01) correctly throws classified SyncError and drops the permanent error from queue', async () => {
    tableResults.set('athlete_profiles', { data: null, error: { code: '42P01', message: 'relation does not exist' } })
    
    const syncService = await import('../syncService')
    await syncService.pushAthleteProfile({
      id: 'default',
      name: 'Rafa',
      updatedAt: 100,
    })

    // The op should have failed permanently
    expect(syncStatusMock).toHaveBeenCalledWith('error', expect.any(String))

    expect(syncDetailsMock).toHaveBeenCalledWith(expect.objectContaining({
      lastErrorCategory: 'schema_mismatch',
      consecutiveFailures: 1,
    }))

    // Queue should be empty since non-retriable gets permanently dropped
    const queue = JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')
    expect(queue).toHaveLength(0)
  })

  it('5. drainQueue processes multiple items and does not stop on a retriable error', async () => {
    tableResults.set('sessions', { data: null, error: { message: 'Network failed' } }) // Assuming it looks like a network error to the fallback
    tableResults.set('day_logs', { data: null, error: null }) // Success

    const syncService = await import('../syncService')
    
    // Queue two ops: sessions (fails), dayLogs (succeeds)
    localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([
      { userId: 'user-1', table: 'sessions', action: 'upsert', payload: { id: 's1' }, enqueuedAt: 1 },
      { userId: 'user-1', table: 'day_logs', action: 'upsert', payload: { id: 'd1' }, enqueuedAt: 2 }
    ]))

    await syncService.drainQueue()

    const newQueue = JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')
    
    // DayLogs should be processed and removed. Sessions should remain.
    expect(newQueue).toHaveLength(1)
    expect(newQueue[0].table).toBe('sessions')
    expect(newQueue[0].retryCount).toBe(1)
  })

  it('7. treats the legacy user_id unique 409 as schema drift without enqueuing a doomed repair', async () => {
    // No existing remote rows → goes to the upsert path
    athleteProfileRows = []
    // This is the exact production contract drift fixed by migration 026: the
    // server still allows only one profile per account while the client writes
    // one canonical profile per athlete.
    upsertResults.set('athlete_profiles', {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "athlete_profiles_user_id_unique"' },
    })

    const syncService = await import('../syncService')
    await syncService.pushAthleteProfile({ id: 'default', name: 'Rafa', updatedAt: 200 })

    // Schema drift is not repairable client-side. Keeping this operation in the
    // retry queue only makes it expire; the local profile remains the recovery
    // source and is re-pushed by full sync after 026 is applied.
    const allCalls = syncDetailsMock.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>)
    const callWithAutoRepair = allCalls.find((c) => 'autoRepairInProgress' in c)
    expect(callWithAutoRepair).toBeDefined()
    expect(callWithAutoRepair!.autoRepairInProgress).toBe(false)
    expect(JSON.parse(localStorage.getItem('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    const callWithCategory = allCalls.find((c) => 'lastErrorCategory' in c)
    expect(callWithCategory?.lastErrorCategory).toBe('schema_mismatch')
  })

  it('8. When a queued op is processed with remote duplicates, the op payload data is written to the canonical row', async () => {
    // Two remote duplicates — the op payload wins (updatedAt 999 > 200 > 100)
    athleteProfileRows = [
      toAthleteProfileSyncRow({ id: 'remote-1', user_id: 'user-1', updated_at: 100, data: { name: 'Old A' } }),
      toAthleteProfileSyncRow({ id: 'remote-2', user_id: 'user-1', updated_at: 200, data: { name: 'Old B' } }),
    ]

    const syncService = await import('../syncService')
    // Push directly — upsertAthleteProfileRow detects duplicates, repairs them,
    // and writes the payload's data to the canonical keeper row
    await syncService.pushAthleteProfile({ id: 'default', name: 'Rafa Repaired', updatedAt: 999 })

    // repairRemoteAthleteProfileRows picks winner by updated_at — payload (999) wins
    expect(updateCalls.length).toBeGreaterThan(0)
    const updatePayload = updateCalls[0].payload as { data: Record<string, unknown> }
    expect(updatePayload.data.name).toBe('Rafa Repaired')
    expect(deleteCalls).toEqual([{ table: 'athlete_profiles', ids: ['remote-2'] }])
  })

  it('9. Preserves remote sport setup when a newer partial profile only updates coach memory or onboarding defer', async () => {
    athleteProfileRows = [
      toAthleteProfileSyncRow({
        id: 'remote-1',
        user_id: 'user-1',
        coach_memory: null,
        updated_at: 100,
        data: {
          name: 'Rafa',
          primarySport: 'squash',
          sportContext: {
            enabledSports: ['squash', 'strength'],
            primarySport: 'squash',
            secondarySports: ['strength'],
          },
        },
      }),
    ]

    const syncService = await import('../syncService')
    await syncService.pushAthleteProfile({
      id: 'default',
      coachMemory: 'Prefiere doble sesion',
      onboardingDeferredAt: 300,
      updatedAt: 300,
    })

    expect(updateCalls).toHaveLength(1)
    const payload = updateCalls[0].payload as {
      coach_memory: string | null
      updated_at: number
      data: Record<string, unknown>
    }
    expect(payload.coach_memory).toBeUndefined()
    expect(payload.updated_at).toBe(300)
    expect(payload.data.name).toBe('Rafa')
    expect(payload.data.primarySport).toBe('squash')
    expect((payload.data.sportContext as { enabledSports?: string[] }).enabledSports).toEqual(['squash', 'strength'])
    expect(payload.data.onboardingDeferredAt).toBe(300)
  })

  it('10. Pushes tombstones when clearing durable profile fields so remote stale values cannot revive them', async () => {
    athleteProfileRows = [
      toAthleteProfileSyncRow({
        id: 'remote-1',
        user_id: 'user-1',
        coach_memory: 'Vieja memoria',
        updated_at: 100,
        data: {
          name: 'Rafa',
          mainGoal: 'Competir mejor',
        },
      }),
    ]

    const syncService = await import('../syncService')
    await syncService.pushAthleteProfile({
      id: 'default',
      coachMemory: undefined,
      name: undefined,
      updatedAt: 300,
    })

    expect(updateCalls).toHaveLength(1)
    const payload = updateCalls[0].payload as {
      coach_memory: string | null
      data: Record<string, unknown>
    }
    expect(payload.coach_memory).toBeUndefined()
    expect(payload.data.__clearCoachMemory).toBe(true)
    expect(payload.data.__deletedFields).toEqual(expect.arrayContaining(['name']))
    expect(payload.data.mainGoal).toBe('Competir mejor')
  })

  it('11. Suppresses automatic athlete profile writes while the post-reset lock is active', async () => {
    localStorageState.set('entrenador_profile_reset_lock_v1', JSON.stringify({
      'user-1': {
        resetAt: 500,
        status: 'awaiting_onboarding_recreation',
      },
    }))

    const syncService = await import('../syncService')
    await syncService.pushAthleteProfile({
      id: 'default',
      name: 'Should Not Sync',
      updatedAt: 600,
    })

    expect(upsertCalls).toHaveLength(0)
    expect(updateCalls).toHaveLength(0)
    expect(localStorage.getItem('entrenador_sync_queue_v1')).toBeNull()
  })

  it('12. Allows onboarding recreation to replace the reset marker and clears the lock', async () => {
    localStorageState.set('entrenador_profile_reset_lock_v1', JSON.stringify({
      'user-1': {
        resetAt: 500,
        status: 'awaiting_onboarding_recreation',
      },
    }))
    athleteProfileRows = [
      toAthleteProfileSyncRow({
        id: 'default',
        user_id: 'user-1',
        coach_memory: null,
        updated_at: 500,
        data: {
          __fullResetAt: 500,
          __deletedFields: ['name', 'primarySport'],
          __clearCoachMemory: true,
        },
      }),
    ]

    const syncService = await import('../syncService')
    await syncService.pushAthleteProfile({
      id: 'default',
      name: 'Rafa Recreated',
      primarySport: 'squash',
      updatedAt: 800,
    }, { source: 'post_reset_onboarding' })

    expect(updateCalls).toHaveLength(1)
    const payload = updateCalls[0].payload as { data: Record<string, unknown> }
    expect(payload.data.name).toBe('Rafa Recreated')
    expect(payload.data.__fullResetAt).toBeUndefined()
    expect(localStorage.getItem('entrenador_profile_reset_lock_v1') ?? '').not.toContain('user-1')
  })

  // Test 6 MUST remain last: it nulls supabase and would contaminate subsequent tests
  it('6. Does not crash when supabase is null', async () => {
    vi.mocked(await import('../auth')).supabase = null as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>

    const syncService = await import('../syncService')
    await syncService.pushAthleteProfile({ id: 'default', updatedAt: 100 })

    expect(syncDetailsMock).toHaveBeenCalledWith(expect.objectContaining({
      lastErrorCategory: 'supabase_not_configured',
    }))
  })
})
