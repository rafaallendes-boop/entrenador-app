import { getActiveAthleteId, getSelfAthleteId } from './activeAthlete'
import { isScopedAthleteId } from './effectiveAthleteKey'

/**
 * Read-scope policy for F2-lite (spec §3.6): scoped rows must match the ACTIVE
 * athlete; legacy/unscoped rows (athleteId missing, empty, or the local profile
 * sentinel ATHLETE_PROFILE_LOCAL_ID) belong to the SELF athlete only — a managed
 * athlete never sees them. With no active athlete (pre-hydration legacy mode)
 * everything is in scope, matching today's single-athlete behavior.
 *
 * NOT for sync delete-scoping — that keeps using `isInAthleteScope`.
 */
export function isRowInActiveScope(rowAthleteId: string | null | undefined): boolean {
  const active = getActiveAthleteId()
  if (!active) return true
  if (isScopedAthleteId(rowAthleteId)) return rowAthleteId === active
  return active === getSelfAthleteId()
}

export function filterRowsToActiveScope<T extends { athleteId?: string }>(rows: T[]): T[] {
  return rows.filter((row) => isRowInActiveScope(row.athleteId))
}

/**
 * Stamp the ACTIVE athlete on a locally-created row. Preserves an existing
 * scoped athleteId (an update/rollback/restore is never re-stamped); with no
 * active athlete the row stays legacy (today's behavior). Local-first
 * counterpart of the read policy: what you create while training athlete X
 * must remain visible under athlete X's scope immediately.
 */
export function withActiveAthleteStamp<T extends { athleteId?: string }>(row: T): T {
  if (isScopedAthleteId(row.athleteId)) return row
  const active = getActiveAthleteId()
  return active ? { ...row, athleteId: active } : row
}
