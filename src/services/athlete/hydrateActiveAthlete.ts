import { db } from '../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from './activeAthlete'
import { athleteIdForOwner } from './athleteScopeMigration'
import { getPersistedAthleteSelection, persistAthleteSelection } from './athleteSelection'

/**
 * Resolve the owner's athletes and publish them to the module holders.
 *
 * Always hydrates the SELF athlete (deterministic `ath_<owner>`, read from the
 * local `athletes` table — populated by backfillLocalAthleteScope or the
 * athletes pull on a fresh device).
 *
 * Selection-aware (spec §3.3): a persisted, VALID selection (existing local
 * athlete row, right owner, active status) is respected — so the callers that
 * re-hydrate on every sync (pullAthletes, ensureRemoteAthlete) confirm instead
 * of clobbering a coach's managed-athlete selection. An invalid selection is
 * cleared and we fall back to the self athlete. Returns the resolved ACTIVE
 * athlete id, or null pre-migration (legacy user_id scope).
 */
export async function hydrateActiveAthlete(ownerAccountId: string): Promise<string | null> {
  const selfRow = await db.athletes.get(athleteIdForOwner(ownerAccountId))
  const selfId = selfRow?.id ?? null
  setSelfAthleteId(selfId)

  const persisted = getPersistedAthleteSelection(ownerAccountId)
  if (persisted && persisted !== selfId) {
    const row = await db.athletes.get(persisted)
    const isValid = !!row && row.ownerAccountId === ownerAccountId && row.status === 'active'
    if (isValid) {
      setActiveAthleteId(persisted)
      return persisted
    }
    persistAthleteSelection(ownerAccountId, null)
  }

  setActiveAthleteId(selfId)
  return selfId
}
