import { getAccountRole } from '../entitlements/accountRoleHolder'
import { db } from '../../db/db'
import type { Athlete, AthleteMembership, MembershipRole } from '../../types'
import { areMembershipsHydrated, getMembershipsForAccount } from './membershipCache'

/**
 * Única autoridad LOCAL de roster: quién está en el roster de una cuenta y con
 * qué acceso. Reemplaza los predicados `ownerAccountId === accountId` que
 * tenían roster, selección, lecturas, escrituras y sync.
 *
 * Regla:
 *  - Caché HIDRATADA (hubo un pull remoto exitoso para esta cuenta en este
 *    dispositivo): la membresía es la única autoridad, igual que la RLS desde
 *    `031`. Un atleta sin membresía no es elegible aunque sea propio: así una
 *    revocación remota cierra el acceso local en el mismo pull.
 *  - Caché NO hidratada (primer arranque offline, Supabase no configurado): la
 *    membresía manda donde existe (espejos optimistas) y el resto se clasifica
 *    según el backfill de membresías de 013b. Es un puente,
 *    no un permiso: nunca se vuelve a él después de hidratar.
 *
 * No es la frontera de seguridad: ésa es la RLS. Es el filtro que evita que la
 * UI ofrezca lo que el servidor va a rechazar.
 */
export type RosterAccess = MembershipRole

export interface RosterEntry {
  athlete: Athlete
  access: RosterAccess
}

/** Clasificación de 013b: linked = owner → self; linked null o ≠ owner → coach del owner; linked = cuenta → self. */
export function legacyAccessFor(accountId: string, athlete: Athlete): RosterAccess | null {
  if (athlete.ownerAccountId === accountId) {
    return athlete.linkedAccountId === accountId ? 'self' : 'coach'
  }
  return athlete.linkedAccountId === accountId ? 'self' : null
}

function accessResolver(
  accountId: string,
  memberships: AthleteMembership[],
  hydrated: boolean,
): (athlete: Athlete) => RosterAccess | null {
  const byAthlete = new Map(memberships.map((membership) => [membership.athleteId, membership.role]))
  if (hydrated) {
    return (athlete) => byAthlete.get(athlete.id) ?? null
  }
  return (athlete) => byAthlete.get(athlete.id) ?? legacyAccessFor(accountId, athlete)
}

export async function resolveRosterAccess(accountId: string, athlete: Athlete): Promise<RosterAccess | null> {
  const [memberships, hydrated] = await Promise.all([
    getMembershipsForAccount(accountId), areMembershipsHydrated(accountId),
  ])
  const access = accessResolver(accountId, memberships, hydrated)(athlete)
  return getAccountRole() === 'coach' && access === 'self' ? null : access
}

export async function resolveRosterEntry(accountId: string, athleteId: string): Promise<RosterEntry | null> {
  const athlete = await db.athletes.get(athleteId)
  if (!athlete) return null
  const access = await resolveRosterAccess(accountId, athlete)
  return access ? { athlete, access } : null
}

function compareEntries(a: RosterEntry, b: RosterEntry): number {
  if (a.access !== b.access) return a.access === 'self' ? -1 : 1
  return (a.athlete.displayName ?? '').localeCompare(b.athlete.displayName ?? '')
}

/** Todo el roster (activos y archivados), self primero y luego por nombre. */
export async function listRosterEntries(accountId: string): Promise<RosterEntry[]> {
  const [memberships, rows, hydrated] = await Promise.all([
    getMembershipsForAccount(accountId),
    db.athletes.toArray(),
    areMembershipsHydrated(accountId),
  ])
  const accessFor = accessResolver(accountId, memberships, hydrated)

  return rows
    .flatMap((athlete) => {
      const access = accessFor(athlete)
      return access && !(getAccountRole() === 'coach' && access === 'self') ? [{ athlete, access }] : []
    })
    .sort(compareEntries)
}
