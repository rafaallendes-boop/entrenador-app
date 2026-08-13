/**
 * Entorno mínimo que `syncService` necesita para no salir por la puerta de atrás.
 *
 * Sin esto los tests del harness serían decorativos: `isEnabled()` sería `false`
 * y cada `push*` retornaría sin tocar el backend, dejando pasar todos los casos.
 */
import { vi } from 'vitest'

import { useAuthStore } from '../../store/useAuthStore'

export const HARNESS_USER_ID = 'harness-user'

/**
 * Self canónico. Un id arbitrario es tratado como atleta **gestionado** por
 * `ensureRemoteAthleteOnce` (`syncService.ts:2219`) y exige una fila en
 * `db.athletes`; usarlo en un caso normal lo haría fallar por el fixture.
 */
export const HARNESS_SELF_ATHLETE_ID = `ath_${HARNESS_USER_ID}`

let previousUser: unknown = null
let installed = false

/**
 * Handles reales creados mientras el harness está instalado.
 *
 * No alcanza con confiar en que un retry tardío encuentre `getUserId() === null`:
 * el test N+1 reinstala el mismo usuario y un timer del test N puede despertar
 * después, ya con auth válido, y escribir sobre el backend equivocado. Se
 * rastrean y se cancelan al restaurar, sin convertir los timeouts de request en
 * fake timers —eso cuelga el push, ver abajo.
 */
const trackedTimeouts = new Set<ReturnType<typeof setTimeout>>()
let originalSetTimeout: typeof setTimeout | null = null

function trackTimers(): void {
  if (originalSetTimeout) return
  originalSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const handle = originalSetTimeout!(handler as never, timeout, ...args as never[])
    trackedTimeouts.add(handle)
    return handle
  }) as typeof setTimeout
}

/**
 * Cancela los timers pendientes sin desinstalar el entorno.
 *
 * Se llama en **cada frontera de dispositivo**, no sólo al cerrar el test: el
 * delete offline programa un retry real (`syncService.ts:2472`) y un caso que
 * dure más que ese retry lo ejecutaría con el otro dispositivo restaurado. Un
 * caso que necesite avanzar el reloj lo hace dentro de su propio turno.
 */
export function clearTrackedTimers(): void {
  for (const handle of trackedTimeouts) clearTimeout(handle)
  trackedTimeouts.clear()
}

function untrackTimers(): void {
  clearTrackedTimers()
  if (originalSetTimeout) {
    globalThis.setTimeout = originalSetTimeout
    originalSetTimeout = null
  }
}

export function installSyncHarnessEnv(userId: string = HARNESS_USER_ID): void {
  if (installed) return
  previousUser = useAuthStore.getState().user
  installed = true

  // `isEnabled()` (`syncService.ts:779-781`) exige la URL: sin ella, todo push
  // sale sin hacer nada y los casos pasarían sin ejercitar sync.
  vi.stubEnv('VITE_SUPABASE_URL', 'https://harness.test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'harness-anon-key')
  // Sin el scope activo el filtrado por atleta no se aplica y los casos de
  // aislamiento pasarían trivialmente.
  vi.stubEnv('VITE_ATHLETE_SCOPE', 'true')

  // `getUserId()` (`syncService.ts:775-777`) lee el store: sin user, `push*`
  // retorna temprano.
  useAuthStore.setState({ user: { id: userId } as never })

  // En el entorno Node `navigator` existe pero `onLine` es `undefined`, así que
  // `!navigator.onLine` es `true` y syncService se cree **offline**: encola todo
  // y nunca escribe. Descubierto por el fail-fast de Task 2.
  setHarnessOnline(true)
  trackTimers()

  // NO se instalan fake timers.
  //
  // El plan los pedía para que un reintento de cola no quedara vivo entre
  // turnos, pero medido acá cuelgan el push: `withRequestTimeout`
  // (`sync/syncSupabase.ts:42-58`) corre un `Promise.race` contra un
  // `setTimeout`, y con timers falsos la cadena nunca se resuelve — el test se
  // va a los 10 s de `testTimeout`.
  //
  // El riesgo se cubre por otro lado: `restoreSyncHarnessEnv` limpia el `user`
  // del auth store, así que un reintento tardío entra a `getUserId()`, obtiene
  // `null` y retorna sin tocar nada. Un caso que necesite avanzar el reloj
  // instala fake timers en su propio ámbito y los conduce con
  // `vi.advanceTimersByTimeAsync`.
}

/**
 * Fija `navigator.onLine`. Es estado de dispositivo: el harness lo snapshotea y
 * el caso offline→online lo alterna explícitamente.
 */
export function setHarnessOnline(online: boolean): void {
  if (typeof navigator === 'undefined') return
  Object.defineProperty(navigator, 'onLine', {
    value: online,
    configurable: true,
    writable: true,
  })
}

export function isHarnessOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine === true
}

export function restoreSyncHarnessEnv(): void {
  if (!installed) return
  installed = false

  untrackTimers()
  vi.unstubAllEnvs()
  useAuthStore.setState({ user: previousUser as never })
  previousUser = null
}
