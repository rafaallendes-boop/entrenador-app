import { db } from '../../db/db'
import { getAccountRole } from '../entitlements/accountRoleHolder'
import { setActiveAthleteId, setSelfAthleteId } from './activeAthlete'
import { athleteIdForOwner } from './athleteScopeMigration'
import { roleOwnsLegacySelfData } from './athleteScopeKind'
import { getPersistedAthleteSelection, persistAthleteSelection } from './athleteSelection'
import { resolveRosterEntry } from './coachRosterEligibility'
import { getSelfMembership } from './membershipCache'

/**
 * Resolve the account's athletes and publish them to the module holders.
 *
 * Self: la membresía `self` si existe; si no, la fila legacy `ath_<owner>`.
 * Un coach confirmado NUNCA tiene self (spec §6): se vetan tanto la fila
 * residual como una membresía self residual, que 037 impide crear pero que un
 * dispositivo puede conservar de un login anterior como atleta.
 *
 * Selección persistida: se respeta sólo si `resolveRosterEntry` la reconoce
 * (membresía, o clasificación legacy mientras la caché no esté hidratada) Y el
 * atleta está activo. Es la misma autoridad que usan roster y switch; antes
 * esta función aceptaba owner sin membresía o membresía sin fila.
 *
 * Devuelve el atleta ACTIVO resuelto, o null (coach sin selección → scope
 * `none`; atleta pre-migración → scope legacy).
 */
export async function hydrateActiveAthlete(ownerAccountId: string): Promise<string | null> {
  const canHaveSelf = roleOwnsLegacySelfData(getAccountRole())
  const selfMembership = canHaveSelf ? await getSelfMembership(ownerAccountId) : undefined
  const legacySelfRow = canHaveSelf && !selfMembership
    ? await db.athletes.get(athleteIdForOwner(ownerAccountId))
    : undefined
  const selfId = selfMembership?.athleteId ?? legacySelfRow?.id ?? null
  setSelfAthleteId(selfId)

  const persisted = getPersistedAthleteSelection(ownerAccountId)
  if (persisted && persisted !== selfId) {
    const entry = await resolveRosterEntry(ownerAccountId, persisted)
    const isValid = !!entry
      && entry.athlete.status === 'active'
      && (canHaveSelf || entry.access === 'coach')
    if (isValid) {
      setActiveAthleteId(persisted)
      return persisted
    }
    persistAthleteSelection(ownerAccountId, null)
  }

  setActiveAthleteId(selfId)
  return selfId
}
