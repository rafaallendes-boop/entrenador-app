import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OfflineOp } from '../syncUtils'

const QUEUE_KEY = 'entrenador_sync_queue_v1'

const localStorageState = new Map<string, string>()

const storeState = {
  user: { id: 'user-1' },
  syncDetails: {
    pendingOps: 0,
    syncAttemptInFlight: false,
    pendingUpserts: 0,
    pendingDeletes: 0,
    oldestPendingOpAt: null as number | null,
    pendingTables: [] as string[],
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
  setSyncStatus: vi.fn(),
  setSyncDetails: vi.fn((patch: Record<string, unknown>) => {
    Object.assign(storeState.syncDetails, patch)
  }),
}

vi.mock('../auth', () => ({ supabase: null }))
vi.mock('../appMaintenance', () => ({ clearAllLocalAppData: vi.fn() }))
vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: { getState: () => storeState },
}))
vi.mock('../../db/db', () => ({
  db: {
    sessions: { toArray: vi.fn(async () => []), put: vi.fn(), delete: vi.fn(), bulkDelete: vi.fn() },
    dayLogs: { toArray: vi.fn(async () => []), put: vi.fn(), delete: vi.fn(), bulkDelete: vi.fn() },
    weekSummaries: { toArray: vi.fn(async () => []), put: vi.fn(), delete: vi.fn(), bulkDelete: vi.fn() },
    trainingPlans: { toArray: vi.fn(async () => []), put: vi.fn(), delete: vi.fn(), bulkDelete: vi.fn() },
    trainingPlanWeeks: { toArray: vi.fn(async () => []), put: vi.fn(), delete: vi.fn(), bulkDelete: vi.fn() },
    chatMessages: { toArray: vi.fn(async () => []), put: vi.fn(), bulkDelete: vi.fn() },
    coachProposals: { toArray: vi.fn(async () => []), put: vi.fn(), bulkDelete: vi.fn() },
    athleteProfiles: { toArray: vi.fn(async () => []), put: vi.fn(), clear: vi.fn() },
  },
}))

function setQueue(ops: OfflineOp[]) {
  localStorageState.set(QUEUE_KEY, JSON.stringify(ops))
}

function readQueue(): OfflineOp[] {
  const raw = localStorageState.get(QUEUE_KEY)
  return raw ? (JSON.parse(raw) as OfflineOp[]) : []
}

function makeOp(overrides: Partial<OfflineOp> = {}): OfflineOp {
  return {
    userId: 'user-1',
    table: 'sessions',
    action: 'upsert',
    payload: { id: 's1', user_id: 'user-1', updated_at: new Date().toISOString() },
    enqueuedAt: Date.now(),
    ...overrides,
  }
}

describe('syncService — pruneStaleQueue & clearPendingOpsForUser', () => {
  beforeEach(() => {
    localStorageState.clear()
    storeState.user = { id: 'user-1' }

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => localStorageState.get(k) ?? null,
        setItem: (k: string, v: string) => { localStorageState.set(k, v) },
        removeItem: (k: string) => { localStorageState.delete(k) },
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

  describe('pruneStaleQueue', () => {
    it('removes ops older than maxAgeMs for the given user', async () => {
      const now = Date.now()
      setQueue([
        makeOp({ enqueuedAt: now - 10 * 24 * 60 * 60 * 1000, payload: { id: 'old' } }),
        makeOp({ enqueuedAt: now - 1 * 60 * 1000, payload: { id: 'fresh' } }),
      ])
      const { pruneStaleQueue } = await import('../syncService')

      pruneStaleQueue('user-1') // default 7 days

      const remaining = readQueue()
      expect(remaining).toHaveLength(1)
      expect((remaining[0].payload as { id: string }).id).toBe('fresh')
    })

    it('respects custom maxAgeMs', async () => {
      const now = Date.now()
      setQueue([
        makeOp({ enqueuedAt: now - 2 * 60 * 60 * 1000, payload: { id: 'old' } }),
        makeOp({ enqueuedAt: now - 30 * 60 * 1000, payload: { id: 'fresh' } }),
      ])
      const { pruneStaleQueue } = await import('../syncService')

      pruneStaleQueue('user-1', 60 * 60 * 1000) // 1 hour

      const remaining = readQueue()
      expect(remaining).toHaveLength(1)
      expect((remaining[0].payload as { id: string }).id).toBe('fresh')
    })

    it('does not affect ops belonging to other users', async () => {
      const now = Date.now()
      setQueue([
        makeOp({ userId: 'user-1', enqueuedAt: now - 10 * 24 * 60 * 60 * 1000, payload: { id: 'mine-old' } }),
        makeOp({ userId: 'user-2', enqueuedAt: now - 10 * 24 * 60 * 60 * 1000, payload: { id: 'theirs-old' } }),
      ])
      const { pruneStaleQueue } = await import('../syncService')

      pruneStaleQueue('user-1')

      const remaining = readQueue()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].userId).toBe('user-2')
    })

    it('is a no-op when there is nothing to prune', async () => {
      const now = Date.now()
      setQueue([makeOp({ enqueuedAt: now - 60 * 1000, payload: { id: 'fresh' } })])
      const before = readQueue()
      const { pruneStaleQueue } = await import('../syncService')

      pruneStaleQueue('user-1')

      expect(readQueue()).toEqual(before)
    })
  })

  describe('clearPendingOpsForUser', () => {
    it('removes all ops for the user when no tables are passed', async () => {
      setQueue([
        makeOp({ userId: 'user-1', table: 'sessions', payload: { id: 'a' } }),
        makeOp({ userId: 'user-1', table: 'chat_messages', payload: { id: 'b' } }),
        makeOp({ userId: 'user-2', table: 'sessions', payload: { id: 'c' } }),
      ])
      const { clearPendingOpsForUser } = await import('../syncService')

      const removed = clearPendingOpsForUser('user-1')

      expect(removed).toBe(2)
      const remaining = readQueue()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].userId).toBe('user-2')
    })

    it('removes only ops for the specified tables when filter is given', async () => {
      setQueue([
        makeOp({ userId: 'user-1', table: 'sessions', payload: { id: 'a' } }),
        makeOp({ userId: 'user-1', table: 'chat_messages', payload: { id: 'b' } }),
        makeOp({ userId: 'user-1', table: 'coach_proposals', payload: { id: 'c' } }),
      ])
      const { clearPendingOpsForUser } = await import('../syncService')

      const removed = clearPendingOpsForUser('user-1', ['chat_messages', 'coach_proposals'])

      expect(removed).toBe(2)
      const remaining = readQueue()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].table).toBe('sessions')
    })

    it('returns 0 and leaves queue intact when nothing matches', async () => {
      setQueue([
        makeOp({ userId: 'user-2', table: 'sessions', payload: { id: 'a' } }),
      ])
      const { clearPendingOpsForUser } = await import('../syncService')

      const removed = clearPendingOpsForUser('user-1')

      expect(removed).toBe(0)
      expect(readQueue()).toHaveLength(1)
    })
  })
})
