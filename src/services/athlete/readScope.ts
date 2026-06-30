import { isAthleteScopeEnabled } from './athleteScopeFlag'
import { getActiveAthleteId } from './activeAthlete'

export type ReadScope = { mode: 'legacy' } | { mode: 'athlete'; athleteId: string }

/**
 * Resolve the scope for reading training data.
 *
 * Hard precondition (from review): athlete scope is used ONLY when the flag is on
 * AND an athlete is hydrated. Flag on but activeAthleteId === null falls back to
 * legacy user_id scope — never produces an `athlete_id = null` query.
 */
export function resolveReadScope(): ReadScope {
  const athleteId = getActiveAthleteId()
  if (isAthleteScopeEnabled() && athleteId) return { mode: 'athlete', athleteId }
  return { mode: 'legacy' }
}
