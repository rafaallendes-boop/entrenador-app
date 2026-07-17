import { getSelfAthleteId } from './activeAthlete'
import { getSelfMembership } from './membershipCache'
import { athleteIdForOwner } from './athleteScopeMigration'

/** Scope resolved once per operation; callers must not re-read global holders. */
export interface AthleteWeekScope {
  athleteId: string
  includeLegacy: boolean
}

/** Link-aware self athlete: hydrated holder, claimed membership, then fallback. */
export async function resolveSelfAthleteIdForOwner(ownerAccountId: string): Promise<string> {
  const holder = getSelfAthleteId()
  if (holder) return holder
  const membership = await getSelfMembership(ownerAccountId)
  return membership?.athleteId ?? athleteIdForOwner(ownerAccountId)
}

/** Legacy/unscoped rows belong exclusively to the resolved self athlete. */
export async function resolveAthleteWeekScope(
  ownerAccountId: string,
  athleteId: string,
): Promise<AthleteWeekScope> {
  const selfId = await resolveSelfAthleteIdForOwner(ownerAccountId)
  return { athleteId, includeLegacy: athleteId === selfId }
}
