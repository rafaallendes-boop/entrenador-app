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

// Deterministic self athlete of the signed-in owner (ath_<owner>), hydrated
// alongside activeAthleteId. Legacy/unscoped rows always belong to the self
// athlete — never to a managed one (F2-lite legacy policy).
let selfAthleteId: string | null = null

export function getSelfAthleteId(): string | null {
  return selfAthleteId
}

export function setSelfAthleteId(id: string | null): void {
  selfAthleteId = id
}

/**
 * True when reads may adopt legacy/unscoped rows: no active athlete yet
 * (pre-hydration legacy mode) or the active athlete IS the self athlete.
 */
export function isSelfScopeActive(): boolean {
  return activeAthleteId === null || activeAthleteId === selfAthleteId
}

// Guard shared by async flows that must discard late writes after an athlete switch.
let switchEpoch = 0

export function getSwitchEpoch(): number {
  return switchEpoch
}

export function bumpSwitchEpoch(): number {
  switchEpoch += 1
  return switchEpoch
}
