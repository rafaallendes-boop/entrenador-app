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
  await db.transaction('rw', db.athleteMemberships, async () => {
    await db.athleteMemberships.where('accountId').equals(accountId).delete()
    const own = memberships.filter((membership) => membership.accountId === accountId)
    if (own.length > 0) await db.athleteMemberships.bulkPut(own)
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
