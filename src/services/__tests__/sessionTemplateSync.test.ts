import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  localRows: [] as Array<Record<string, unknown>>,
  remoteRows: [] as Array<Record<string, unknown>>,
  upsertCalls: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  fetchCalls: [] as string[],
  localPutCalls: 0,
  localBulkDeletes: [] as string[][],
  simulateVersionedTombstoneGuard: false,
  storage: new Map<string, string>(),
  authState: {
    user: { id: 'user-1' } as { id: string } | null,
    syncDetails: {
      pendingOps: 0,
      pendingUpserts: 0,
      pendingDeletes: 0,
      pendingTables: [] as string[],
      consecutiveFailures: 0,
    } as Record<string, unknown>,
    setSyncStatus: vi.fn(),
    setSyncDetails(patch: Record<string, unknown>) {
      Object.assign(this.syncDetails, patch)
    },
  },
}))

vi.mock('../../db/db', () => ({
  db: {
    sessionTemplates: {
      toArray: vi.fn(async () => testState.localRows.map((row) => structuredClone(row))),
      put: vi.fn(async (row: Record<string, unknown>) => {
        testState.localPutCalls += 1
        const index = testState.localRows.findIndex((item) => item.id === row.id)
        if (index >= 0) testState.localRows[index] = structuredClone(row)
        else testState.localRows.push(structuredClone(row))
      }),
      bulkDelete: vi.fn(async (ids: string[]) => {
        testState.localBulkDeletes.push([...ids])
        testState.localRows = testState.localRows.filter((row) => !ids.includes(row.id as string))
      }),
    },
  },
}))

vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: {
    getState: () => testState.authState,
  },
}))

vi.mock('../sync/syncSupabase', () => ({
  FETCH_PAGE_SIZE: 1000,
  fetchAll: vi.fn(async (table: string) => {
    testState.fetchCalls.push(table)
    return testState.remoteRows.map((row) => structuredClone(row))
  }),
  getSupabase: vi.fn(() => ({
    from: (table: string) => ({
      upsert: async (payload: Record<string, unknown>) => {
        testState.upsertCalls.push({ table, payload: structuredClone(payload) })
        if (table === 'session_templates' && testState.simulateVersionedTombstoneGuard) {
          const existingIndex = testState.remoteRows.findIndex((row) => row.id === payload.id)
          const existing = testState.remoteRows[existingIndex]
          if (
            existingIndex >= 0
            && existing.deleted_at != null
            && payload.deleted_at == null
            && Number(payload.updated_at) > Number(existing.updated_at)
          ) {
            testState.remoteRows[existingIndex] = {
              ...existing,
              updated_at: payload.updated_at,
              deleted_at: payload.updated_at,
            }
          }
        }
        return { data: null, error: null }
      },
    }),
  })),
  withRequestTimeout: vi.fn(async (source: PromiseLike<unknown>) => Promise.resolve(source)),
}))

vi.mock('../syncDiagnostics', () => ({
  computeTierHealthMap: () => ({ A: 'healthy', B: 'healthy', C: 'healthy' }),
  recordSyncError: vi.fn(),
  trackSyncEvent: vi.fn(),
}))

import { isSupportedSessionTemplate } from '../../types/sessionTemplate'
import {
  mergeSessionTemplates,
  drainQueue,
  pushSessionTemplate,
  rowToStoredSessionTemplate,
  sessionTemplateToRow,
} from '../syncService'
import { loadQueue } from '../sync/syncQueue'

type Template = ReturnType<typeof rowToStoredSessionTemplate>
type MergeContext = Parameters<typeof mergeSessionTemplates>[1]

function template(overrides: Partial<Template> = {}): Template {
  return {
    id: 't1',
    name: 'Volea',
    kind: 'session',
    payloadVersion: 1,
    payload: {
      type: 'squash',
      timeBlock: 'AM',
      title: 'Volea',
      durationMin: 60,
    },
    createdAt: 10,
    updatedAt: 100,
    ...overrides,
  } as Template
}

function remoteRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
    user_id: 'user-1',
    name: 'Volea remota',
    kind: 'session',
    payload_version: 1,
    data: {
      type: 'squash',
      timeBlock: 'AM',
      title: 'Volea remota',
      durationMin: 60,
    },
    created_at: 10,
    updated_at: 100,
    deleted_at: null,
    ...overrides,
  }
}

function mergeContext(options: {
  allowDeletes?: boolean
  pendingWipe?: boolean
} = {}): MergeContext {
  return {
    allowDeletes: options.allowDeletes ?? true,
    deleteBeforeTs: null,
    readScope: { mode: 'legacy' },
    activeAthleteId: null,
    pendingWrites: [],
    pendingRemoteWipeTables: new Set(options.pendingWipe ? ['session_templates'] : []),
  } as MergeContext
}

async function runPending(context: MergeContext): Promise<void> {
  for (const write of context.pendingWrites) await write()
}

describe('session template sync', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
    testState.localRows = []
    testState.remoteRows = []
    testState.upsertCalls = []
    testState.fetchCalls = []
    testState.localPutCalls = 0
    testState.localBulkDeletes = []
    testState.simulateVersionedTombstoneGuard = false
    testState.authState.user = { id: 'user-1' }
    testState.authState.syncDetails = {
      pendingOps: 0,
      pendingUpserts: 0,
      pendingDeletes: 0,
      pendingTables: [],
      consecutiveFailures: 0,
    }
    testState.authState.setSyncStatus.mockReset()
    testState.storage.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => testState.storage.get(key) ?? null,
        setItem: (key: string, value: string) => testState.storage.set(key, value),
        removeItem: (key: string) => testState.storage.delete(key),
        clear: () => testState.storage.clear(),
      },
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('always pushes live rows and tombstones through upsert', async () => {
    const live = template()
    const deleted = template({ id: 't2', updatedAt: 200, deletedAt: 200 })

    await pushSessionTemplate(live)
    await pushSessionTemplate(deleted)

    expect(testState.upsertCalls).toEqual([
      {
        table: 'session_templates',
        payload: {
          id: 't1',
          user_id: 'user-1',
          name: 'Volea',
          kind: 'session',
          payload_version: 1,
          data: live.payload,
          created_at: 10,
          updated_at: 100,
          deleted_at: null,
        },
      },
      {
        table: 'session_templates',
        payload: expect.objectContaining({
          id: 't2',
          updated_at: 200,
          deleted_at: 200,
        }),
      },
    ])
  })

  it('queues an offline tombstone as upsert, never delete', async () => {
    vi.useFakeTimers()
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: false },
    })

    await pushSessionTemplate(template({ updatedAt: 200, deletedAt: 200 }))

    expect(loadQueue()).toEqual([
      expect.objectContaining({
        table: 'session_templates',
        action: 'upsert',
        payload: expect.objectContaining({ deleted_at: 200, updated_at: 200 }),
      }),
    ])
    expect(loadQueue().some((op) => op.action === 'delete')).toBe(false)
    expect(testState.upsertCalls).toEqual([])
  })

  it('compacts offline create/edit/delete into one tombstone upsert and replays it as upsert', async () => {
    vi.useFakeTimers()
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: false },
    })

    await pushSessionTemplate(template({ updatedAt: 100 }))
    await pushSessionTemplate(template({ name: 'Editada', updatedAt: 200 }))
    await pushSessionTemplate(template({ name: 'Editada', updatedAt: 300, deletedAt: 300 }))

    expect(loadQueue()).toEqual([
      expect.objectContaining({
        table: 'session_templates',
        action: 'upsert',
        payload: expect.objectContaining({ id: 't1', updated_at: 300, deleted_at: 300 }),
      }),
    ])

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    })
    await expect(drainQueue()).resolves.toBe(true)
    expect(loadQueue()).toEqual([])
    expect(testState.upsertCalls).toEqual([
      expect.objectContaining({
        table: 'session_templates',
        payload: expect.objectContaining({ id: 't1', updated_at: 300, deleted_at: 300 }),
      }),
    ])
  })

  it('round-trips unsupported rows without treating their payload as supported', () => {
    const row = remoteRow({
      kind: 'future-session',
      payload_version: 9,
      data: { future: { opaque: true } },
      updated_at: 900,
      deleted_at: 900,
    })

    const stored = rowToStoredSessionTemplate(row)

    expect(isSupportedSessionTemplate(stored)).toBe(false)
    expect(sessionTemplateToRow(stored, 'user-1')).toEqual(row)
  })

  it('persists newer remote live rows and tombstones in Dexie', async () => {
    testState.localRows = [
      template({ id: 'live', updatedAt: 100 }) as unknown as Record<string, unknown>,
      template({ id: 'deleted', updatedAt: 100 }) as unknown as Record<string, unknown>,
    ]
    testState.remoteRows = [
      remoteRow({ id: 'live', updated_at: 200, name: 'Live remota' }),
      remoteRow({ id: 'deleted', updated_at: 300, deleted_at: 300, name: 'Borrada remota' }),
    ]
    const context = mergeContext()

    await mergeSessionTemplates('user-1', context)

    expect(testState.localRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'live', name: 'Live remota', updatedAt: 200 }),
      expect.objectContaining({ id: 'deleted', updatedAt: 300, deletedAt: 300 }),
    ]))
    expect(context.pendingWrites).toHaveLength(0)
  })

  it('schedules every strictly newer local winner, including both deletion states', async () => {
    testState.localRows = [
      template({ id: 'live', updatedAt: 300 }) as unknown as Record<string, unknown>,
      template({ id: 'deleted', updatedAt: 400, deletedAt: 400 }) as unknown as Record<string, unknown>,
    ]
    testState.remoteRows = [
      remoteRow({ id: 'live', updated_at: 200, deleted_at: 200 }),
      remoteRow({ id: 'deleted', updated_at: 200, deleted_at: null }),
    ]
    const context = mergeContext()

    await mergeSessionTemplates('user-1', context)
    expect(context.pendingWrites).toHaveLength(2)
    await runPending(context)

    expect(testState.upsertCalls.map((call) => call.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'live', updated_at: 300, deleted_at: null }),
      expect.objectContaining({ id: 'deleted', updated_at: 400, deleted_at: 400 }),
    ]))
  })

  it('converges a newer local live row to the server versioned tombstone on the next pull', async () => {
    testState.localRows = [
      template({ updatedAt: 300, name: 'Live local' }) as unknown as Record<string, unknown>,
    ]
    testState.remoteRows = [
      remoteRow({ updated_at: 200, deleted_at: 200, name: 'Tombstone remoto' }),
    ]
    testState.simulateVersionedTombstoneGuard = true

    const firstPull = mergeContext()
    await mergeSessionTemplates('user-1', firstPull)
    expect(firstPull.pendingWrites).toHaveLength(1)
    await runPending(firstPull)
    expect(testState.remoteRows).toEqual([
      expect.objectContaining({
        id: 't1',
        name: 'Tombstone remoto',
        updated_at: 300,
        deleted_at: 300,
      }),
    ])

    const secondPull = mergeContext()
    await mergeSessionTemplates('user-1', secondPull)

    expect(testState.localRows).toEqual([
      expect.objectContaining({
        id: 't1',
        name: 'Tombstone remoto',
        updatedAt: 300,
        deletedAt: 300,
      }),
    ])
    expect(secondPull.pendingWrites).toHaveLength(0)
  })

  it('uses delete-wins symmetrically for equal timestamps', async () => {
    testState.localRows = [
      template({ id: 'remote-deleted', updatedAt: 200 }) as unknown as Record<string, unknown>,
      template({ id: 'local-deleted', updatedAt: 200, deletedAt: 200 }) as unknown as Record<string, unknown>,
    ]
    testState.remoteRows = [
      remoteRow({ id: 'remote-deleted', updated_at: 200, deleted_at: 200 }),
      remoteRow({ id: 'local-deleted', updated_at: 200, deleted_at: null }),
    ]
    const context = mergeContext()

    await mergeSessionTemplates('user-1', context)

    expect(testState.localRows.find((row) => row.id === 'remote-deleted'))
      .toMatchObject({ updatedAt: 200, deletedAt: 200 })
    expect(testState.localRows.find((row) => row.id === 'local-deleted'))
      .toMatchObject({ updatedAt: 200, deletedAt: 200 })
    expect(context.pendingWrites).toHaveLength(1)
    await runPending(context)
    expect(testState.upsertCalls.at(-1)?.payload).toMatchObject({
      id: 'local-deleted',
      deleted_at: 200,
    })
  })

  it('uses the remote row as canonical for equal live versions', async () => {
    testState.localRows = [
      template({ updatedAt: 200, name: 'Nombre local' }) as unknown as Record<string, unknown>,
    ]
    testState.remoteRows = [
      remoteRow({ updated_at: 200, name: 'Nombre remoto' }),
    ]
    const context = mergeContext()

    await mergeSessionTemplates('user-1', context)

    expect(testState.localRows).toEqual([
      expect.objectContaining({ id: 't1', name: 'Nombre remoto', updatedAt: 200 }),
    ])
    expect(testState.localPutCalls).toBe(1)
    expect(context.pendingWrites).toHaveLength(0)
  })

  it('does not rewrite an already converged equal-version row', async () => {
    const remote = remoteRow({ updated_at: 200, name: 'Convergida' })
    testState.remoteRows = [remote]
    testState.localRows = [
      rowToStoredSessionTemplate(remote) as unknown as Record<string, unknown>,
    ]
    const context = mergeContext()

    await mergeSessionTemplates('user-1', context)

    expect(testState.localPutCalls).toBe(0)
    expect(context.pendingWrites).toHaveLength(0)
  })

  describe('tombstone retention', () => {
    const TTL_MS = 180 * 24 * 60 * 60 * 1000
    const expiredAt = Date.now() - TTL_MS - 1000
    const freshAt = Date.now() - 1000

    it('prunes a tombstone both sides have long agreed on', async () => {
      const expired = { updated_at: expiredAt, deleted_at: expiredAt }
      testState.remoteRows = [remoteRow(expired)]
      testState.localRows = [
        template({ updatedAt: expiredAt, deletedAt: expiredAt }) as unknown as Record<string, unknown>,
      ]
      const context = mergeContext()

      await mergeSessionTemplates('user-1', context)

      expect(testState.localBulkDeletes).toEqual([['t1']])
      expect(testState.localRows).toEqual([])
      expect(testState.localPutCalls).toBe(0)
      expect(context.pendingWrites).toHaveLength(0)
    })

    it('keeps a tombstone that is still inside the retention window', async () => {
      const fresh = { updated_at: freshAt, deleted_at: freshAt }
      testState.remoteRows = [remoteRow(fresh)]
      testState.localRows = [
        template({ updatedAt: freshAt, deletedAt: freshAt }) as unknown as Record<string, unknown>,
      ]

      await mergeSessionTemplates('user-1', mergeContext())

      expect(testState.localBulkDeletes).toEqual([])
      expect(testState.localRows).toHaveLength(1)
    })

    it('never prunes while the local row is still live', async () => {
      // Expiry is a GC of agreed deletions, not a delete path. A live local row
      // must still win and repair the server.
      testState.remoteRows = [remoteRow({ updated_at: expiredAt, deleted_at: expiredAt })]
      testState.localRows = [
        template({ updatedAt: expiredAt + 5000 }) as unknown as Record<string, unknown>,
      ]
      const context = mergeContext()

      await mergeSessionTemplates('user-1', context)

      expect(testState.localBulkDeletes).toEqual([])
      expect(context.pendingWrites).toHaveLength(1)
    })

    it('drops an expired local tombstone instead of re-pushing it forever', async () => {
      testState.remoteRows = []
      testState.localRows = [
        template({ updatedAt: expiredAt, deletedAt: expiredAt }) as unknown as Record<string, unknown>,
      ]
      const context = mergeContext({ allowDeletes: true })

      await mergeSessionTemplates('user-1', context)

      expect(context.pendingWrites).toHaveLength(0)
      expect(testState.localBulkDeletes).toEqual([['t1']])
    })

    it('still re-pushes an absent local tombstone inside the window', async () => {
      testState.remoteRows = []
      testState.localRows = [
        template({ updatedAt: freshAt, deletedAt: freshAt }) as unknown as Record<string, unknown>,
      ]
      const context = mergeContext({ allowDeletes: true })

      await mergeSessionTemplates('user-1', context)

      expect(context.pendingWrites).toHaveLength(1)
      expect(testState.localBulkDeletes).toEqual([])
    })
  })

  it('re-pushes absent locals only with a drained queue and no pending wipe', async () => {
    testState.localRows = [template() as unknown as Record<string, unknown>]

    const drained = mergeContext({ allowDeletes: true })
    await mergeSessionTemplates('user-1', drained)
    expect(drained.pendingWrites).toHaveLength(1)

    const notDrained = mergeContext({ allowDeletes: false })
    await mergeSessionTemplates('user-1', notDrained)
    expect(notDrained.pendingWrites).toHaveLength(0)

    const pendingWipe = mergeContext({ allowDeletes: true, pendingWipe: true })
    await mergeSessionTemplates('user-1', pendingWipe)
    expect(pendingWipe.pendingWrites).toHaveLength(0)
  })

  it('persists an unsupported remote row opaquely', async () => {
    testState.remoteRows = [remoteRow({
      kind: 'future-session',
      payload_version: 7,
      data: { opaque: ['future', 7] },
    })]
    const context = mergeContext()

    await mergeSessionTemplates('user-1', context)

    const stored = testState.localRows[0] as Template
    expect(stored).toMatchObject({
      id: 't1',
      kind: 'future-session',
      payloadVersion: 7,
      payload: { opaque: ['future', 7] },
    })
    expect(isSupportedSessionTemplate(stored)).toBe(false)
  })
})
