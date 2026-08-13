// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../../db/db'
import { useAuthStore } from '../../../store/useAuthStore'
import { useTrainingStore } from '../../../store/useTrainingStore'
import { createFakePostgrest, type FakePostgrest } from '../fakePostgrest'
import { setActiveFakeBackend } from '../backendRegistry'
import { HARNESS_USER_ID, installSyncHarnessEnv, restoreSyncHarnessEnv } from '../harnessEnv'
import { createDeviceHarness, type DeviceHarness } from '../deviceHarness'

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

describe('deviceHarness', () => {
  it('aísla la cola de sync entre dispositivos', async () => {
    await harness.withDevice('A', async () => {
      localStorage.setItem('probe', 'de-A')
    })
    await harness.withDevice('B', async () => {
      expect(localStorage.getItem('probe')).toBeNull()
      localStorage.setItem('probe', 'de-B')
    })
    await harness.withDevice('A', async () => {
      expect(localStorage.getItem('probe')).toBe('de-A')
    })
  })

  it('aísla el contenido de Dexie entre dispositivos', async () => {
    await harness.withDevice('A', async () => {
      await db.sessions.put({ id: 's-a', athleteId: 'ath-1', date: '2026-08-12' } as never)
    })
    await harness.withDevice('B', async () => {
      expect(await db.sessions.count()).toBe(0)
    })
    await harness.withDevice('A', async () => {
      expect(await db.sessions.count()).toBe(1)
    })
  })

  it('restaura el entorno aunque el callback falle y conserva los métodos del store', async () => {
    await expect(harness.withDevice('A', async () => {
      useTrainingStore.setState({ requestedWeekStart: '2026-08-10' } as never)
      throw new Error('boom')
    })).rejects.toThrow('boom')

    // El snapshot se tomó igual: el `finally` corre pese al fallo.
    expect(harness.snapshotOf('A').training.requestedWeekStart).toBe('2026-08-10')
    expect(typeof useTrainingStore.getState().loadWeek).toBe('function')
  })

  it('registra el dueño original de cada fila y no lo sobrescribe', async () => {
    harness.seedSnapshot('A', { sessions: [{ id: 's-1', athleteId: 'ath-1' }] })
    harness.seedSnapshot('A', { sessions: [{ id: 's-1', athleteId: 'ath-2' }] })
    expect(harness.ownershipOf('A').get('sessions/s-1')).toBe('ath-1')
  })

  it('cancela los timers pendientes al cambiar de dispositivo', async () => {
    // Un delete offline programa un retry real (`syncService.ts:2472`). Si el
    // caso dura más que ese retry, se ejecutaría con B restaurado y escribiría
    // sobre el dispositivo equivocado.
    let fired = false

    // El retardo debe superar con holgura el `capture()` del `finally`, que
    // hace I/O de Dexie: con 1 ms el timer podía dispararse legítimamente antes
    // de la frontera y el test quedaba flaky por timing, no por el contrato.
    await harness.withDevice('A', async () => {
      setTimeout(() => { fired = true }, 50)
    })

    await harness.withDevice('B', async () => {
      await new Promise((resolve) => setTimeout(resolve, 150))
    })

    expect(fired).toBe(false)
  })

  it('restaura el usuario autenticado y el atleta activo del store', async () => {
    await harness.withDevice('A', async () => {
      useAuthStore.setState({ user: { id: 'u-A' } as never, activeAthleteId: 'ath-A' } as never)
    })
    await harness.withDevice('B', async () => {
      useAuthStore.setState({ user: { id: 'u-B' } as never, activeAthleteId: 'ath-B' } as never)
    })
    await harness.withDevice('A', async () => {
      expect((useAuthStore.getState().user as { id: string } | null)?.id).toBe('u-A')
      expect(useAuthStore.getState().activeAthleteId).toBe('ath-A')
    })
  })

  it('conserva el estado online por dispositivo', async () => {
    await harness.withDevice('A', async () => { harness.setOnline(false) })
    await harness.withDevice('B', async () => {
      expect(navigator.onLine).toBe(true)
    })
    await harness.withDevice('A', async () => {
      expect(navigator.onLine).toBe(false)
    })
  })
})
