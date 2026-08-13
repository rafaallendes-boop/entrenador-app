// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../../db/db'
import { createFakePostgrest, type FakePostgrest } from '../fakePostgrest'
import { setActiveFakeBackend } from '../backendRegistry'
import { HARNESS_USER_ID, installSyncHarnessEnv, restoreSyncHarnessEnv } from '../harnessEnv'
import { createDeviceHarness, type DeviceHarness } from '../deviceHarness'
import {
  assertConverged,
  assertNoScopeLeak,
  assertTrace,
  assertVisibleWeekStable,
} from '../syncExitCriteria'

vi.mock('../../../services/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { getActiveFakeBackend } = await import('../backendRegistry')
  return {
    ...actual,
    isSupabaseConfigured: true,
    get supabase() {
      return getActiveFakeBackend()?.client ?? null
    },
  }
})

let backend: FakePostgrest
let harness: DeviceHarness

beforeEach(async () => {
  db.close()
  await db.delete()
  await db.open()
  backend = createFakePostgrest()
  setActiveFakeBackend(backend)
  installSyncHarnessEnv(HARNESS_USER_ID)
  harness = createDeviceHarness(backend)
})

afterEach(async () => {
  await harness.dispose()
  restoreSyncHarnessEnv()
  setActiveFakeBackend(null)
  db.close()
})

describe('syncExitCriteria', () => {
  it('assertConverged falla cuando los dispositivos difieren', () => {
    harness.seedSnapshot('A', { sessions: [{ id: 's1', updatedAt: 2 }] })
    harness.seedSnapshot('B', { sessions: [{ id: 's1', updatedAt: 1 }] })
    expect(() => assertConverged(harness, 'A', 'B', 'sessions')).toThrow(/no convergen/)
  })

  it('assertConverged pasa cuando coinciden pese al orden', () => {
    harness.seedSnapshot('A', { sessions: [{ id: 'b' }, { id: 'a' }] })
    harness.seedSnapshot('B', { sessions: [{ id: 'a' }, { id: 'b' }] })
    expect(() => assertConverged(harness, 'A', 'B', 'sessions')).not.toThrow()
  })

  it('assertNoScopeLeak detecta que una fila cambió de dueño', () => {
    harness.seedSnapshot('A', { sessions: [{ id: 's1', athleteId: 'ath-1' }] })
    harness.seedSnapshot('A', { sessions: [{ id: 's1', athleteId: 'ath-2' }] })
    expect(() => assertNoScopeLeak(harness, ['A'], 'ath-1')).toThrow(/cambió de athleteId/)
  })

  it('assertNoScopeLeak tolera filas cacheadas de otro atleta en Dexie', () => {
    // Una cuenta de coach cachea varios atletas: eso es legítimo. Lo que se
    // prohíbe es que la proyección visible los mezcle.
    harness.seedSnapshot('A', {
      sessions: [{ id: 's1', athleteId: 'ath-1' }, { id: 's2', athleteId: 'ath-2' }],
    })
    expect(() => assertNoScopeLeak(harness, ['A'], 'ath-1')).not.toThrow()
  })

  it('assertVisibleWeekStable detecta sus tres modos de fallo', () => {
    const stable = {
      requestedWeekStart: '2026-08-10',
      loadedWeekStart: '2026-08-10',
      sessionWeekStarts: ['2026-08-10'],
      summaryWeekStart: '2026-08-10',
    }
    expect(() => assertVisibleWeekStable([stable])).not.toThrow()

    expect(() => assertVisibleWeekStable([
      { ...stable, sessionWeekStarts: ['2026-08-03', '2026-08-10'] },
    ])).toThrow(/mezcló semanas/)

    expect(() => assertVisibleWeekStable([
      { ...stable, sessionWeekStarts: ['2026-08-03'] },
    ])).toThrow(/expuso sesiones/)

    expect(() => assertVisibleWeekStable([
      { ...stable, summaryWeekStart: '2026-08-03' },
    ])).toThrow(/El resumen visible/)
  })

  it('assertVisibleWeekStable tolera el estado intermedio de una transición', () => {
    // `requestedWeekStart !== loadedWeekStart` con la proyección todavía
    // coherente es exactamente lo que PR #11 dejó como frontera válida.
    expect(() => assertVisibleWeekStable([{
      requestedWeekStart: '2026-08-10',
      loadedWeekStart: '2026-08-03',
      sessionWeekStarts: ['2026-08-03'],
      summaryWeekStart: '2026-08-03',
    }])).not.toThrow()
  })

  it('assertTrace no cuenta los selects genéricos de runFullSync', () => {
    backend.trace.push({
      op: 'select',
      table: 'sessions',
      columns: '*',
      filters: [{ op: 'eq', column: 'user_id', value: 'u1' }],
    })
    expect(() => assertTrace(backend, { naturalKeySelects: 1 })).toThrow(/naturalKeySelects/)
  })

  it('assertTrace reconoce el select de clave natural por su forma', () => {
    backend.trace.push({
      op: 'select',
      table: 'day_logs',
      columns: 'id, updated_at',
      filters: [
        { op: 'eq', column: 'user_id', value: 'u1' },
        { op: 'eq', column: 'athlete_id', value: 'ath-1' },
        { op: 'eq', column: 'date', value: '2026-08-12' },
      ],
    })
    expect(() => assertTrace(backend, { naturalKeySelects: 1 })).not.toThrow()
  })

  it('assertTrace distingue lt de eq sobre updated_at', () => {
    backend.trace.push({
      op: 'update',
      table: 'day_logs',
      filters: [{ op: 'eq', column: 'updated_at', value: 100 }],
    })
    expect(() => assertTrace(backend, { conditionalUpdates: 1 })).toThrow(/conditionalUpdates/)

    backend.trace.push({
      op: 'update',
      table: 'day_logs',
      filters: [{ op: 'lt', column: 'updated_at', value: 100 }],
    })
    expect(() => assertTrace(backend, { conditionalUpdates: 1 })).not.toThrow()
  })
})
