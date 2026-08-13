// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from '../../../services/athlete/activeAthlete'
import { resolveWeekStartToRefresh, useTrainingStore } from '../../../store/useTrainingStore'
import { addDays } from 'date-fns'

import { fromISO, toISO } from '../../../utils/date'
import { createFakePostgrest, type FakePostgrest } from '../fakePostgrest'
import { setActiveFakeBackend } from '../backendRegistry'
import {
  HARNESS_SELF_ATHLETE_ID,
  HARNESS_USER_ID,
  installSyncHarnessEnv,
  restoreSyncHarnessEnv,
} from '../harnessEnv'
import { createDeviceHarness, type DeviceHarness } from '../deviceHarness'
import { assertVisibleWeekStable, type TrainingStoreTransition } from '../syncExitCriteria'

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

const OLD_WEEK = '2026-08-03'
const NEW_WEEK = '2026-08-10'

let backend: FakePostgrest
let harness: DeviceHarness

/**
 * `rowToSession` hace `...data` (`syncService.ts:1783-1795`): sin
 * `data.weekStartDate` la sesión hidratada sale inválida y el caso fallaría por
 * el fixture.
 */
function remoteSessionRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 's1',
    user_id: HARNESS_USER_ID,
    athlete_id: HARNESS_SELF_ATHLETE_ID,
    date: '2026-08-12',
    type: 'squash',
    status: 'planned',
    time_block: 'AM',
    authored_by_role: 'self',
    created_at: 1,
    updated_at: 1,
    data: { weekStartDate: NEW_WEEK, title: 'base', durationMin: 60, timeBlock: 'AM' },
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

describe('semana visible durante el merge', () => {
  it('ninguna transición combina datos de semanas distintas durante el refresh', async () => {
    const { pullSessionsForDateRange } = await import('../../../services/syncService')

    backend.seed('sessions', [
      remoteSessionRow({
        id: 's-old',
        date: '2026-08-05',
        data: { weekStartDate: OLD_WEEK, title: 'vieja', durationMin: 60, timeBlock: 'AM' },
      }),
      remoteSessionRow({
        id: 's-new',
        date: '2026-08-12',
        data: { weekStartDate: NEW_WEEK, title: 'nueva', durationMin: 60, timeBlock: 'AM' },
      }),
    ])

    const transitions: TrainingStoreTransition[] = []

    await harness.withDevice('A', async () => {
      // 1. Estado de partida: la semana VIEJA realmente cargada. Arrancar vacío
      // haría que la fila vieja nunca participe y el test pasaría sin probar
      // nada: no habría dos semanas que mezclar.
      await db.sessions.put({
        id: 's-old',
        athleteId: HARNESS_SELF_ATHLETE_ID,
        weekStartDate: OLD_WEEK,
        date: '2026-08-05',
        type: 'squash',
        status: 'planned',
        timeBlock: 'AM',
        title: 'vieja',
        durationMin: 60,
        authoredByRole: 'self',
        createdAt: 1,
        updatedAt: 10,
      } as never)
      await useTrainingStore.getState().loadWeek(OLD_WEEK)
      expect(useTrainingStore.getState().loadedWeekStart).toBe(OLD_WEEK)
      expect(useTrainingStore.getState().sessions).toHaveLength(1)

      // 2. El usuario pide la semana nueva; recién acá empieza la observación.
      useTrainingStore.setState({ requestedWeekStart: NEW_WEEK })
      const unsubscribe = useTrainingStore.subscribe((state) => {
        transitions.push({
          requestedWeekStart: state.requestedWeekStart,
          loadedWeekStart: state.loadedWeekStart,
          sessionWeekStarts: [...new Set(state.sessions.map((session) => session.weekStartDate))],
          summaryWeekStart: state.currentWeekSummary?.weekStartDate ?? null,
        })
      })

      // 3. Secuencia de prioridad del bootstrap (`App.tsx:254-275`): resolver
      // destino → pull acotado → volver a resolver → cargar. Observar sólo el
      // pull no registraría transición alguna: no toca el store.
      const target = resolveWeekStartToRefresh(useTrainingStore.getState(), NEW_WEEK)
      await pullSessionsForDateRange(target, toISO(addDays(fromISO(target), 6)))
      const finalTarget = resolveWeekStartToRefresh(useTrainingStore.getState(), NEW_WEEK)
      await useTrainingStore.getState().loadWeek(finalTarget)

      unsubscribe()
    })

    expect(backend.unsupported).toEqual([])
    // Sin esto el test pasaría por no haber observado nada.
    expect(transitions.length).toBeGreaterThan(0)

    // Y sin esto pasaría observando sólo transiciones vacías: el pull acotado
    // tiene que haber traído la sesión de la semana nueva para que la
    // aserción llegue a comparar dos semanas con datos. Fue exactamente el
    // agujero que destapó la comparación numérica de fechas del doble.
    expect(transitions[0].sessionWeekStarts).toEqual([OLD_WEEK])
    expect(transitions.at(-1)).toMatchObject({
      loadedWeekStart: NEW_WEEK,
      sessionWeekStarts: [NEW_WEEK],
    })

    assertVisibleWeekStable(transitions)
  })
})
