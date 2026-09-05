import { getActiveAthleteId, getSelfAthleteId } from './activeAthlete'
import { getAccountRole } from '../entitlements/accountRoleHolder'
import { canAdoptLegacyRows, resolveAthleteScopeKind } from './athleteScopeKind'
import { isScopedAthleteId } from './effectiveAthleteKey'
import type { MembershipRole } from '../../types'

/**
 * Read-scope policy for F2-lite (spec §3.6): scoped rows must match the ACTIVE
 * athlete; legacy/unscoped rows (athleteId missing, empty, or the local profile
 * sentinel ATHLETE_PROFILE_LOCAL_ID) belong to the SELF athlete only — a managed
 * athlete never sees them. With no active athlete, only a confirmed athlete
 * keeps the pre-hydration legacy behavior; `coach` and `unknown` resolve to an
 * empty scope.
 *
 * NOT for sync delete-scoping — that keeps using `isInAthleteScope`.
 */
export function isRowInActiveScope(rowAthleteId: string | null | undefined): boolean {
  const active = getActiveAthleteId()
  const scope = resolveAthleteScopeKind({
    accountRole: getAccountRole(),
    activeAthleteId: active,
    selfAthleteId: getSelfAthleteId(),
  })

  // `none` represents the empty set: until the role is verified, or a coach
  // selects an athlete, no local row is readable. This is intentionally
  // stricter than the legacy pre-hydration path, which only athletes retain.
  if (scope === 'none') return false
  if (!active) return true
  if (isScopedAthleteId(rowAthleteId)) return rowAthleteId === active
  return canAdoptLegacyRows(scope)
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

export function resolveAuthoredByRole(athleteId: string | undefined): MembershipRole {
  const self = getSelfAthleteId()
  if (!athleteId || !self) return 'self'
  return athleteId === self ? 'self' : 'coach'
}
