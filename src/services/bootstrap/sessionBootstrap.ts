import type { ResolvedAccountRole } from '../entitlements/entitlementPolicy'
import { roleOwnsLegacySelfData } from '../athlete/athleteScopeKind'

export interface SessionBootstrapDeps {
  /** Frontera destructiva de cuenta: debe ser la primera operación async. */
  prepareLocalDataForUser: (userId: string) => Promise<unknown>
  hydrateRole: (userId: string) => Promise<ResolvedAccountRole>
  pullMemberships: (userId: string) => Promise<unknown>
   /**
   * No se invoca para una cuenta coach. `null` = hay un claim pendiente: el
   * scope local no debe hidratarse todavía.
   */
  backfillLegacyScope: (userId: string) => Promise<string | null | undefined | void>
  hydrateAthleteScope: (userId: string) => Promise<unknown>
  runFullSync: (userId: string) => Promise<unknown>
}

let epoch = 0
// La frontera modifica Dexie y LAST_SYNC_USER_KEY. Una cola de módulo evita que
// dos usuarios estén dentro de ella a la vez; se recupera de errores para no
// bloquear el siguiente inicio de sesión.
let chain: Promise<void> = Promise.resolve()

export function getBootstrapEpoch(): number {
  return epoch
}

/** Invalida síncronamente una corrida en curso, también al cerrar sesión. */
export function invalidateSessionBootstrap(): number {
  epoch += 1
  return epoch
}

/**
 * Arranque secuencial de una sesión:
 * frontera → rol → memberships → [backfill sólo athlete] → scope → sync.
 *
 * El epoch y la cola cumplen funciones distintas: el primero evita que una
 * corrida ya obsoleta continúe después de un await; la segunda impide que dos
 * fronteras de cuentas distintas muten Dexie simultáneamente.
 */
export function runSessionBootstrap(
  userId: string,
  deps: SessionBootstrapDeps,
): Promise<void> {
  const mine = invalidateSessionBootstrap()
  const run = chain.then(() => executeBootstrap(userId, deps, mine))
  chain = run.then(() => undefined, () => undefined)
  return run
}

async function executeBootstrap(
  userId: string,
  deps: SessionBootstrapDeps,
  mine: number,
): Promise<void> {
  const isStale = () => mine !== epoch

  // Una corrida que quedó en cola y fue desplazada no toca Dexie en absoluto.
  if (isStale()) return

  await deps.prepareLocalDataForUser(userId)
  if (isStale()) return

  const role = await deps.hydrateRole(userId)
  if (isStale()) return

  await deps.pullMemberships(userId)
  if (isStale()) return

  // Las filas legacy pertenecen exclusivamente al self. Un coach no tiene
  // self, por lo que este backfill sería una adopción indebida.
  //
  // Un rol ilegible (`unknown`) sigue el camino de `athlete`, la misma regla
  // que `resolveAthleteScopeKind`: sólo un coach CONFIRMADO cambia el curso.
  // Cortar acá dejaba una sesión offline sin memberships, sin scope y sin sync
  // hasta el siguiente evento `online`/`focus` — en una app local-first eso es
  // peor que el riesgo que evitaba, porque para que una cuenta coach tuviera
  // filas legacy tendría que haber sido atleta antes en este dispositivo.
  let skipScopeHydration = false
  if (roleOwnsLegacySelfData(role)) {
    const backfilled = await deps.backfillLegacyScope(userId)
    if (isStale()) return
    // `null` significa claim pendiente: vincular el scope al self legacy antes
    // de resolver el claim ataría la sesión al atleta equivocado. El sync sí
    // continúa, igual que antes de extraer este arranque a un módulo.
    skipScopeHydration = backfilled === null
  }

  if (!skipScopeHydration) {
    await deps.hydrateAthleteScope(userId)
    if (isStale()) return
  }

  await deps.runFullSync(userId)
}
