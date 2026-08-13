// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from '../../../services/athlete/activeAthlete'
import { createFakePostgrest, type FakePostgrest } from '../fakePostgrest'
import { setActiveFakeBackend } from '../backendRegistry'
import {
  HARNESS_SELF_ATHLETE_ID,
  HARNESS_USER_ID,
  installSyncHarnessEnv,
  restoreSyncHarnessEnv,
} from '../harnessEnv'
import { createDeviceHarness, type DeviceHarness } from '../deviceHarness'
import { assertConverged, assertQueuesDrained, assertTrace } from '../syncExitCriteria'

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
  setSelfAthleteId(HARNESS_SELF_ATHLETE_ID)
  setActiveAthleteId(HARNESS_SELF_ATHLETE_ID)
  harness = createDeviceHarness(backend)
})

afterEach(async () => {
  await harness.dispose()
  restoreSyncHarnessEnv()
  setActiveFakeBackend(null)
  db.close()
})

describe('clave natural — day_logs', () => {
  it('reconcilia un 23505 y deja una sola fila remota', async () => {
    const { pushDayLog } = await import('../../../services/syncService')

    await harness.withDevice('A', async () => {
      await db.dayLogs.put({
        id: 'log-a', athleteId: HARNESS_SELF_ATHLETE_ID, date: '2026-08-12', updatedAt: 100,
      } as never)
      await pushDayLog(await db.dayLogs.get('log-a') as never)
    })

    await harness.withDevice('B', async () => {
      await db.dayLogs.put({
        id: 'log-b', athleteId: HARNESS_SELF_ATHLETE_ID, date: '2026-08-12', updatedAt: 200,
      } as never)
      await pushDayLog(await db.dayLogs.get('log-b') as never)
    })

    // Converger no basta: hay que demostrar que se ejercitó la reconciliación.
    assertTrace(backend, { conflicts: 1, naturalKeySelects: 1, conditionalUpdates: 1 })

    // El único compuesto se respeta: una sola fila ocupa [athlete_id+date].
    expect(backend.rows('day_logs')).toHaveLength(1)
    expect(backend.rows('day_logs')[0]).toMatchObject({ updated_at: 200 })

    assertQueuesDrained(harness, ['A', 'B'])
  })
})

describe('clave natural — week_summaries', () => {
  it('reconcilia un 23505 sobre week_start_date', async () => {
    const { pushWeekSummary } = await import('../../../services/syncService')

    await harness.withDevice('A', async () => {
      await db.weekSummaries.put({
        id: 'ws-a', athleteId: HARNESS_SELF_ATHLETE_ID, weekStartDate: '2026-08-10', updatedAt: 100,
      } as never)
      await pushWeekSummary(await db.weekSummaries.get('ws-a') as never)
    })

    await harness.withDevice('B', async () => {
      await db.weekSummaries.put({
        id: 'ws-b', athleteId: HARNESS_SELF_ATHLETE_ID, weekStartDate: '2026-08-10', updatedAt: 200,
      } as never)
      await pushWeekSummary(await db.weekSummaries.get('ws-b') as never)
    })

    assertTrace(backend, { conflicts: 1, naturalKeySelects: 1, conditionalUpdates: 1 })
    expect(backend.rows('week_summaries')).toHaveLength(1)
    assertQueuesDrained(harness, ['A', 'B'])
  })
})

describe('convergencia tras el conflicto', () => {
  it('ambos dispositivos ven la misma fila y el sync termina limpio', async () => {
    const { pushDayLog, runFullSync } = await import('../../../services/syncService')

    await harness.withDevice('A', async () => {
      await db.dayLogs.put({
        id: 'log-a', athleteId: HARNESS_SELF_ATHLETE_ID, date: '2026-08-12', updatedAt: 100,
      } as never)
      await pushDayLog(await db.dayLogs.get('log-a') as never)
      await runFullSync(HARNESS_USER_ID)
    })

    await harness.withDevice('B', async () => {
      await db.dayLogs.put({
        id: 'log-b', athleteId: HARNESS_SELF_ATHLETE_ID, date: '2026-08-12', updatedAt: 200,
      } as never)
      await pushDayLog(await db.dayLogs.get('log-b') as never)
      await runFullSync(HARNESS_USER_ID)
    })

    await harness.withDevice('A', async () => {
      await runFullSync(HARNESS_USER_ID)
    })

    // `runFullSync` no propaga al caller, pero tampoco es mudo: deja
    // `syncStatus`, `lastErrorCategory` y programa retry. Afirmar las señales
    // terminales es lo que distingue "sincronizó" de "falló en silencio";
    // `unsupported === []` por sí solo no detecta un TypeError común.
    expect(backend.unsupported).toEqual([])
    for (const device of ['A', 'B'] as const) {
      const auth = harness.snapshotOf(device).auth
      // `idle` exacto, no `!== 'error'`: `offline`, `degraded` y `syncing`
      // también son terminales insatisfactorios y pasarían la forma negativa.
      expect(auth.syncStatus).toBe('idle')
      expect(auth.syncError).toBeNull()
      expect((auth.syncDetails as { lastSuccessfulSyncAt: number | null }).lastSuccessfulSyncAt)
        .not.toBeNull()
    }

    assertConverged(harness, 'A', 'B', 'dayLogs')
    assertQueuesDrained(harness, ['A', 'B'])
  })
})
