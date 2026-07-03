const SELECTION_KEY_PREFIX = 'entrenador_active_athlete'

function selectionKey(ownerAccountId: string): string {
  return `${SELECTION_KEY_PREFIX}:${ownerAccountId}`
}

/** The persisted active-athlete selection for this owner, or null. */
export function getPersistedAthleteSelection(ownerAccountId: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(selectionKey(ownerAccountId))
  } catch {
    return null
  }
}

/** Persist the active-athlete selection; null clears it. */
export function persistAthleteSelection(ownerAccountId: string, athleteId: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (athleteId === null) {
      localStorage.removeItem(selectionKey(ownerAccountId))
      return
    }
    localStorage.setItem(selectionKey(ownerAccountId), athleteId)
  } catch {
    // ignore (private mode / storage full) — selection just won't persist
  }
}
