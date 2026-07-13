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
