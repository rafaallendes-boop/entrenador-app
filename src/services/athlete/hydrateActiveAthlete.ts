import { db } from '../../db/db'
import { setActiveAthleteId } from './activeAthlete'
import { athleteIdForOwner } from './athleteScopeMigration'

/**
 * Resolve the owner's active athlete id and publish it to the module holder.
 *
 * The id is deterministic (`ath_<owner>`), so we read it directly from the local
 * `athletes` table (populated by backfillLocalAthleteScope, or by the athletes
 * pull on a fresh device). Returns null when no athlete row exists yet, in which
 * case consumers fall back to legacy `user_id` scope.
 */
export async function hydrateActiveAthlete(ownerAccountId: string): Promise<string | null> {
  const row = await db.athletes.get(athleteIdForOwner(ownerAccountId))
  const id = row?.id ?? null
  setActiveAthleteId(id)
  return id
}
