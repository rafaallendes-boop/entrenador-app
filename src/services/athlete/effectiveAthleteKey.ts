import { ATHLETE_PROFILE_LOCAL_ID } from './activeAthlete'

const LEGACY_KEY = 'legacy'

export function isScopedAthleteId(athleteId: string | null | undefined): athleteId is string {
  return typeof athleteId === 'string' && athleteId.length > 0 && athleteId !== ATHLETE_PROFILE_LOCAL_ID
}

export function effectiveAthleteKey(
  rowAthleteId: string | null | undefined,
  activeAthleteId: string | null,
): string {
  if (isScopedAthleteId(rowAthleteId)) return rowAthleteId
  if (activeAthleteId) return activeAthleteId
  return LEGACY_KEY
}

export function isInAthleteScope(
  rowAthleteId: string | null | undefined,
  activeAthleteId: string | null,
): boolean {
  if (!activeAthleteId) return true
  if (!isScopedAthleteId(rowAthleteId)) return true
  return rowAthleteId === activeAthleteId
}
