import { db } from '../../db/db'
import type { AthleteMembership, MembershipRole } from '../../types'

export function membershipFromRemoteRow(row: Record<string, unknown>): AthleteMembership {
  return {
    athleteId: row.athlete_id as string,
    accountId: row.account_id as string,
    role: row.role as MembershipRole,
    createdAt: (row.created_at as number) ?? 0,
    updatedAt: (row.updated_at as number) ?? 0,
  }
}

export async function replaceMembershipCache(accountId: string, memberships: AthleteMembership[]): Promise<void> {
  if (!db.athleteMemberships || typeof db.transaction !== 'function') return
  await db.transaction('rw', [db.athleteMemberships, ...(db.membershipSnapshots ? [db.membershipSnapshots] : [])], async () => {
    const pending = (await getMembershipsForAccount(accountId))
      .filter((membership) => membership.pendingCreation && membership.role === 'coach')
    await db.athleteMemberships.where('accountId').equals(accountId).delete()
    const own = memberships.filter((membership) => membership.accountId === accountId)
    // Un pull corre antes del replay: una alta offline aún no puede aparecer
    // en el servidor. Sólo se conservan esas altas explícitas, nunca permisos
    // confirmados que hayan sido revocados. La respuesta remota manda por ID.
    const confirmedIds = new Set(own.map((membership) => membership.athleteId))
    const snapshot = [
      ...own.map((membership) => ({ ...membership, pendingCreation: false })),
      ...pending.filter((membership) => !confirmedIds.has(membership.athleteId)),
    ]
    if (snapshot.length > 0) await db.athleteMemberships.bulkPut(snapshot)
    await markMembershipsHydrated(accountId)
  })
}

export function getMembershipsForAccount(accountId: string): Promise<AthleteMembership[]> {
  if (!db.athleteMemberships) return Promise.resolve([])
  return db.athleteMemberships.where('accountId').equals(accountId).toArray()
}

export async function getSelfMembership(accountId: string): Promise<AthleteMembership | undefined> {
  return (await getMembershipsForAccount(accountId)).find((membership) => membership.role === 'self')
}

export async function getMembershipAthleteIds(accountId: string): Promise<string[]> {
  return (await getMembershipsForAccount(accountId)).map((membership) => membership.athleteId)
}

export async function getRoleForAthlete(accountId: string, athleteId: string): Promise<MembershipRole | null> {
  if (!db.athleteMemberships) return null
  return (await db.athleteMemberships.get([athleteId, accountId]))?.role ?? null
}

/** El snapshot vacío también es autoritativo; se guarda en la misma transacción. */
export async function areMembershipsHydrated(accountId: string): Promise<boolean> {
  return !!(await db.membershipSnapshots?.get(accountId))
}

export async function markMembershipsHydrated(accountId: string): Promise<void> {
  await db.membershipSnapshots?.put({ accountId, hydratedAt: Date.now() })
}

/**
 * Espejo optimista de una membresía que el servidor va a sembrar
 * (`athletes_seed_membership`, 013b) o ya sembró. `replaceMembershipCache`
 * la reemplaza por la verdad remota en el siguiente pull; no es autoridad.
 */
export async function putLocalMembership(
  accountId: string,
  athleteId: string,
  role: MembershipRole,
  pendingCreation = false,
): Promise<void> {
  if (!db.athleteMemberships) return
  const existing = await db.athleteMemberships.get([athleteId, accountId])
  if (existing?.role === role) return
  const now = Date.now()
  await db.athleteMemberships.bulkPut([{
    athleteId,
    accountId,
    role,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(pendingCreation ? { pendingCreation: true } : {}),
  }])
}

/** Confirmar el INSERT antes de permitir que otro snapshot revoque el vínculo. */
export async function acknowledgeLocalMembershipCreation(accountId: string, athleteId: string): Promise<void> {
  if (!db.athleteMemberships) return
  await db.transaction('rw', db.athleteMemberships, async () => {
    const membership = await db.athleteMemberships.get([athleteId, accountId])
    if (membership?.pendingCreation) {
      await db.athleteMemberships.bulkPut([{ ...membership, pendingCreation: false }])
    }
  })
}

export async function hasCoachMembership(accountId: string, athleteId: string): Promise<boolean> {
  return (await getMembershipsForAccount(accountId))
    .some((membership) => membership.athleteId === athleteId && membership.role === 'coach')
}
