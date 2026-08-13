// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFakePostgrest } from '../fakePostgrest'
import { setActiveFakeBackend } from '../backendRegistry'
import {
  HARNESS_SELF_ATHLETE_ID,
  HARNESS_USER_ID,
  installSyncHarnessEnv,
  restoreSyncHarnessEnv,
} from '../harnessEnv'
import { useAuthStore } from '../../../store/useAuthStore'

// Cabecera obligatoria de todo archivo de integración del harness. El `vi.mock`
// es hoisted y por archivo: no se hereda ni puede centralizarse en un helper
// importado, porque el hoisting corre antes que los imports.
//
// El getter es deliberado: `setActiveFakeBackend` cambia por test, y un valor
// capturado una sola vez dejaría a todos los tests hablando con el primer backend.
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

afterEach(() => {
  restoreSyncHarnessEnv()
  setActiveFakeBackend(null)
})

describe('harnessEnv', () => {
  it('deja a syncService escribiendo contra el doble', async () => {
    const backend = createFakePostgrest()
    setActiveFakeBackend(backend)
    installSyncHarnessEnv(HARNESS_USER_ID)

    expect(useAuthStore.getState().user?.id).toBe(HARNESS_USER_ID)

    const { pushDayLog } = await import('../../../services/syncService')
    await pushDayLog({
      id: 'log-1',
      athleteId: HARNESS_SELF_ATHLETE_ID,
      date: '2026-08-12',
      updatedAt: 100,
    } as never)

    expect(backend.rows('day_logs')).toHaveLength(1)
    expect(backend.rows('day_logs')[0]).toMatchObject({
      id: 'log-1',
      user_id: HARNESS_USER_ID,
      athlete_id: HARNESS_SELF_ATHLETE_ID,
      date: '2026-08-12',
    })
  })

  it('sin instalar el entorno, push no escribe nada', async () => {
    // Documenta la puerta trasera: sin `user` en el auth store, `getUserId()`
    // devuelve null y `push*` retorna temprano sin tocar el backend.
    const backend = createFakePostgrest()
    setActiveFakeBackend(backend)

    const { pushDayLog } = await import('../../../services/syncService')
    await pushDayLog({
      id: 'log-2',
      athleteId: HARNESS_SELF_ATHLETE_ID,
      date: '2026-08-12',
      updatedAt: 100,
    } as never)

    expect(backend.rows('day_logs')).toHaveLength(0)
  })

  it('restaura el entorno y los timers reales', () => {
    installSyncHarnessEnv(HARNESS_USER_ID)
    expect(useAuthStore.getState().user?.id).toBe(HARNESS_USER_ID)

    restoreSyncHarnessEnv()
    expect(useAuthStore.getState().user).toBeNull()
  })
})
