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
import { assertConverged, assertQueuesDrained } from '../syncExitCriteria'

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

/** Versión ganadora: la más nueva. */
const LWW_A_UPDATED_AT = 2000
/** Más antigua, y además la que llega última al backend. */
const LWW_B_UPDATED_AT = 1000
/** Idéntico en ambos dispositivos: el backend desempata. */
const TIE_UPDATED_AT = 3000
/** Rondas de sync alternadas; una sola no basta para propagar en ambos sentidos. */
const SYNC_ROUNDS = 3

let backend: FakePostgrest
let harness: DeviceHarness

/**
 * `rowToSession` (`syncService.ts:1783-1795`) hace `...data`, así que una sesión
 * local necesita los campos que la app espera dentro del payload. Se construye
 * acá para que ningún caso falle por el fixture en vez de por sync.
 */
function localSession(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 's1',
    athleteId: HARNESS_SELF_ATHLETE_ID,
    weekStartDate: '2026-08-10',
    date: '2026-08-12',
    type: 'squash',
    status: 'planned',
    timeBlock: 'AM',
    durationMin: 60,
    createdAt: 1,
    // Producción lo estampa al crear (`useTrainingStore.ts:158`), y
    // `sessionToRow` lo deriva igual al subir (`syncService.ts:1571`). Sin él,
    // el dispositivo que hidrata desde el backend tendría un campo que el que
    // la escribió no — una divergencia del fixture, no de sync.
    authoredByRole: 'self',
    ...overrides,
  }
}

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

describe('sessions — last-write-wins', () => {
  it('conserva la versión más nueva aunque la más antigua llegue última', async () => {
    const { pushSession, runFullSync } = await import('../../../services/syncService')

    await harness.withDevice('A', async () => {
      await db.sessions.put(localSession({ title: 'A gana', updatedAt: LWW_A_UPDATED_AT }) as never)
      await pushSession(await db.sessions.get('s1') as never)
    })

    await harness.withDevice('B', async () => {
      await db.sessions.put(localSession({ title: 'B pierde', updatedAt: LWW_B_UPDATED_AT }) as never)
      await pushSession(await db.sessions.get('s1') as never)
    })

    for (let round = 0; round < SYNC_ROUNDS; round++) {
      await harness.withDevice('A', async () => { await runFullSync(HARNESS_USER_ID) })
      await harness.withDevice('B', async () => { await runFullSync(HARNESS_USER_ID) })
    }

    expect(backend.unsupported).toEqual([])
    expect(harness.snapshotOf('A').dexie.sessions).toMatchObject([{ title: 'A gana' }])
    expect(harness.snapshotOf('B').dexie.sessions).toMatchObject([{ title: 'A gana' }])
    expect(backend.rows('sessions')).toMatchObject([
      { data: expect.objectContaining({ title: 'A gana' }) },
    ])
    assertConverged(harness, 'A', 'B', 'sessions')
    assertQueuesDrained(harness, ['A', 'B'])
  })

  it('desempata a favor de la versión remota cuando updatedAt es idéntico', async () => {
    // B llega última al backend. Ante timestamps idénticos, el backend es la
    // autoridad estable: A debe adoptar B en vez de conservar una versión
    // divergente para siempre.
    const { pushSession, runFullSync } = await import('../../../services/syncService')

    await harness.withDevice('A', async () => {
      await db.sessions.put(localSession({ title: 'version A', updatedAt: TIE_UPDATED_AT }) as never)
      await pushSession(await db.sessions.get('s1') as never)
    })

    await harness.withDevice('B', async () => {
      await db.sessions.put(localSession({ title: 'version B', updatedAt: TIE_UPDATED_AT }) as never)
      await pushSession(await db.sessions.get('s1') as never)
    })

    for (let round = 0; round < SYNC_ROUNDS; round++) {
      await harness.withDevice('A', async () => { await runFullSync(HARNESS_USER_ID) })
      await harness.withDevice('B', async () => { await runFullSync(HARNESS_USER_ID) })
    }

    expect(backend.unsupported).toEqual([])
    const a = harness.snapshotOf('A').dexie.sessions as Array<{ title: string }>
    const b = harness.snapshotOf('B').dexie.sessions as Array<{ title: string }>
    expect(a[0]?.title).toBe('version B')
    expect(b[0]?.title).toBe('version B')
    expect(backend.rows('sessions')).toMatchObject([
      { data: expect.objectContaining({ title: 'version B' }) },
    ])
    assertConverged(harness, 'A', 'B', 'sessions')
    assertQueuesDrained(harness, ['A', 'B'])
  })

  it('usa el mismo desempate remoto en el pull acotado por fechas', async () => {
    const { pullSessionsForDateRange, pushSession } = await import('../../../services/syncService')

    await harness.withDevice('A', async () => {
      await db.sessions.put(localSession({ title: 'version A', updatedAt: TIE_UPDATED_AT }) as never)
      await pushSession(await db.sessions.get('s1') as never)
    })

    await harness.withDevice('B', async () => {
      await db.sessions.put(localSession({ title: 'version B', updatedAt: TIE_UPDATED_AT }) as never)
      await pushSession(await db.sessions.get('s1') as never)
    })

    await harness.withDevice('A', async () => {
      await pullSessionsForDateRange('2026-08-10', '2026-08-16')
    })

    expect(backend.unsupported).toEqual([])
    expect(harness.snapshotOf('A').dexie.sessions).toMatchObject([{ title: 'version B' }])
  })
})
