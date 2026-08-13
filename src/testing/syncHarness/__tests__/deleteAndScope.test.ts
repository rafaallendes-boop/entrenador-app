// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from '../../../services/athlete/activeAthlete'
import { useTrainingStore } from '../../../store/useTrainingStore'
import { createFakePostgrest, type FakePostgrest } from '../fakePostgrest'
import { setActiveFakeBackend } from '../backendRegistry'
import {
  HARNESS_SELF_ATHLETE_ID,
  HARNESS_USER_ID,
  installSyncHarnessEnv,
  restoreSyncHarnessEnv,
} from '../harnessEnv'
import { createDeviceHarness, type DeviceHarness } from '../deviceHarness'
import { assertNoResurrection, assertNoScopeLeak, assertQueuesDrained } from '../syncExitCriteria'

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

const WEEK_START = '2026-08-10'
const SESSION_DATE = '2026-08-12'

let backend: FakePostgrest
let harness: DeviceHarness

function localSession(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 's1',
    athleteId: HARNESS_SELF_ATHLETE_ID,
    weekStartDate: WEEK_START,
    date: SESSION_DATE,
    type: 'squash',
    status: 'planned',
    timeBlock: 'AM',
    durationMin: 60,
    createdAt: 1,
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

describe('delete offline→online', () => {
  it('un borrado offline drena al reconectar y no resucita', async () => {
    const { pushSession, runFullSync, deleteSessionForTarget } = await import('../../../services/syncService')

    await harness.withDevice('A', async () => {
      await db.sessions.put(localSession({ id: 's-del', title: 'a borrar', updatedAt: 100 }) as never)
      await pushSession(await db.sessions.get('s-del') as never)
      await runFullSync(HARNESS_USER_ID)
    })

    await harness.withDevice('B', async () => { await runFullSync(HARNESS_USER_ID) })
    expect(harness.snapshotOf('B').dexie.sessions).toHaveLength(1)

    await harness.withDevice('A', async () => {
      harness.setOnline(false)
      // `deleteSessionForTarget` ejecuta **sólo** el camino remoto
      // (`syncService.ts:2457-2471`): sin este delete local el borrado nunca
      // ocurre en el dispositivo y el caso no probaría nada.
      await db.sessions.delete('s-del')
      // `RemoteSessionTarget` exige `kind` (`sync/remoteSessionTarget.ts:4-6`).
      // Sin él el drain descarta la op como `queue:invalid_session_target_drop`
      // y el caso terminaría verde por el tombstone posterior, sin haber
      // ejercitado el replay de la cola.
      await deleteSessionForTarget('s-del', { kind: 'scoped', athleteId: HARNESS_SELF_ATHLETE_ID })
    })

    // Fuera del turno: el snapshot se toma en el `finally`, así que consultarlo
    // dentro de `withDevice` devolvería todavía el anterior.
    expect(JSON.stringify(harness.snapshotOf('A').localStorage)).toContain('s-del')

    await harness.withDevice('A', async () => {
      harness.setOnline(true)
      await runFullSync(HARNESS_USER_ID)
    })
    await harness.withDevice('B', async () => { await runFullSync(HARNESS_USER_ID) })

    expect(backend.unsupported).toEqual([])
    expect(backend.rows('sessions').find((row) => row.id === 's-del')).toBeUndefined()
    assertNoResurrection(harness, 'sessions', ['s-del'], ['A', 'B'])
    assertQueuesDrained(harness, ['A', 'B'])
  })
})

describe('aislamiento entre dos atletas', () => {
  it('con dos atletas la semana visible proyecta sólo el activo', async () => {
    const { pushSession, runFullSync } = await import('../../../services/syncService')
    const managedAthleteId = 'ath-managed-1'

    await harness.withDevice('A', async () => {
      // El segundo atleta es **gestionado**: sin su fila en `db.athletes`,
      // `ensureRemoteAthleteOnce` (`syncService.ts:2219`) no lo reconoce y el
      // push fallaría por el fixture.
      await db.athletes.bulkPut([
        {
          id: HARNESS_SELF_ATHLETE_ID,
          ownerAccountId: HARNESS_USER_ID,
          linkedAccountId: HARNESS_USER_ID,
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: managedAthleteId,
          ownerAccountId: HARNESS_USER_ID,
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
        },
      ] as never)

      setActiveAthleteId(HARNESS_SELF_ATHLETE_ID)
      await db.sessions.put(localSession({ id: 's-1', title: 'del self', updatedAt: 100 }) as never)
      await pushSession(await db.sessions.get('s-1') as never)

      setActiveAthleteId(managedAthleteId)
      await db.sessions.put(localSession({
        id: 's-2', athleteId: managedAthleteId, title: 'del gestionado', updatedAt: 100,
      }) as never)
      await pushSession(await db.sessions.get('s-2') as never)

      setActiveAthleteId(HARNESS_SELF_ATHLETE_ID)
      await runFullSync(HARNESS_USER_ID)
      await useTrainingStore.getState().loadWeek(WEEK_START)
    })

    expect(backend.unsupported).toEqual([])
    // La aserción real es sobre la **proyección visible**: cachear ambos
    // atletas en Dexie es legítimo en una cuenta de coach.
    const visible = harness.snapshotOf('A').training.sessions as Array<{ id: string }>
    expect(visible.map((row) => row.id)).toContain('s-1')
    expect(visible.map((row) => row.id)).not.toContain('s-2')
    assertNoScopeLeak(harness, ['A'], HARNESS_SELF_ATHLETE_ID)
  })
})
