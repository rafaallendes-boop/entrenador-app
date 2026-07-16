import type { Athlete } from '../../types'

export interface SelectAthleteAndNavigateDeps {
  switchActiveAthlete: (ownerAccountId: string, athleteId: string) => Promise<boolean>
  navigate: (destination: string) => void
}

export interface SelectAthleteAndNavigateResult {
  navigated: boolean
  switched: boolean
}

/**
 * Switches the active athlete (if needed) and navigates to `destination`.
 * Deps are injected so this can be unit-tested without mocking Dexie or react-router.
 */
export async function selectAthleteAndNavigate(
  deps: SelectAthleteAndNavigateDeps,
  ownerAccountId: string,
  athleteId: string,
  activeAthleteId: string | null,
  destination: string,
): Promise<SelectAthleteAndNavigateResult> {
  if (athleteId === activeAthleteId) {
    deps.navigate(destination)
    return { navigated: true, switched: false }
  }
  const ok = await deps.switchActiveAthlete(ownerAccountId, athleteId)
  if (!ok) return { navigated: false, switched: false }
  deps.navigate(destination)
  return { navigated: true, switched: true }
}

export interface CreateAndActivateAthleteDeps {
  createManagedAthlete: (ownerAccountId: string, displayName: string) => Promise<Athlete>
  switchActiveAthlete: (ownerAccountId: string, athleteId: string) => Promise<boolean>
}

export interface CreateAndActivateAthleteResult {
  athlete: Athlete
  activated: boolean
}

/**
 * Creates a managed athlete and tries to activate it. Once creation succeeded this
 * always resolves with the created athlete — a failed activation (false *or* thrown)
 * only sets `activated: false`, so the caller keeps the athlete visible in the roster
 * instead of reporting a creation that actually happened as an error.
 * Only rejects if creation itself fails.
 */
export async function createAndActivateAthlete(
  deps: CreateAndActivateAthleteDeps,
  ownerAccountId: string,
  displayName: string,
): Promise<CreateAndActivateAthleteResult> {
  const athlete = await deps.createManagedAthlete(ownerAccountId, displayName)
  try {
    return { athlete, activated: await deps.switchActiveAthlete(ownerAccountId, athlete.id) }
  } catch {
    return { athlete, activated: false }
  }
}

/**
 * Lock de modulo (no un `useRef`) para serializar acciones de atleta desde
 * `CoachWorkspacePage`. Un switch exitoso cambia `activeAthleteId` en
 * `switchActiveAthlete` ANTES de que su propio `loadMemory()` resuelva; eso
 * dispara el `key={activeAthleteId}` de `AppShell`, que desmonta y remonta
 * `CoachWorkspacePage` con una instancia nueva. Un `useRef` local se pierde
 * ahi — la instancia nueva arranca con un lock "libre" aunque la promesa del
 * switch original siga corriendo en background. Un `let` de modulo sobrevive
 * a cualquier remount porque el modulo se evalua una sola vez por carga de
 * pagina, sin importar cuantas veces React reemplace el componente.
 */
let athleteActionLocked = false
let rosterRevision = 0
const rosterRevisionListeners = new Set<() => void>()

/** true si ya hay un switch o una creacion de atleta en curso. */
export function isAthleteActionLocked(): boolean {
  return athleteActionLocked
}

/** Intenta tomar el lock. Devuelve false (sin tocar nada) si ya estaba tomado. */
export function acquireAthleteActionLock(): boolean {
  if (athleteActionLocked) return false
  athleteActionLocked = true
  return true
}

/** Libera el lock. Idempotente: liberar sin haberlo tomado no lanza. */
export function releaseAthleteActionLock(): void {
  athleteActionLocked = false
}

/**
 * Snapshot persistente entre remounts del AppShell. Archivar al atleta activo
 * primero cambia al self, lo que remonta el workspace antes de que termine la
 * mutacion. Esta revision fuerza a la instancia nueva a recargar ambas listas.
 */
export function getCoachRosterRevision(): number {
  return rosterRevision
}

export function subscribeCoachRosterRevision(listener: () => void): () => void {
  rosterRevisionListeners.add(listener)
  return () => rosterRevisionListeners.delete(listener)
}

export function notifyCoachRosterChanged(): void {
  rosterRevision += 1
  for (const listener of rosterRevisionListeners) listener()
}
