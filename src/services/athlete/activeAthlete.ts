/** Local Dexie key of the singleton athlete profile. Never written to athlete_id. */
export const ATHLETE_PROFILE_LOCAL_ID = 'default'

// Module-local holder so non-React services can read the active athlete id
// without depending on a React/Zustand hook.
let activeAthleteId: string | null = null

/** The hydrated athlete id, or null when not yet resolved. */
export function getActiveAthleteId(): string | null {
  return activeAthleteId
}

export function setActiveAthleteId(id: string | null): void {
  activeAthleteId = id
}
