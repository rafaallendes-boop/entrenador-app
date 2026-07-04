import { db } from '../../db/db'
import type { Athlete } from '../../types'
import { v4 as uuid } from '../../utils/uuid'
import * as syncService from '../syncService'
import { athleteIdForOwner } from './athleteScopeMigration'

/**
 * Create a coach-managed athlete (no login: linkedAccountId stays null).
 * Persists locally first and queues the remote push.
 */
export async function createManagedAthlete(ownerAccountId: string, displayName: string): Promise<Athlete> {
  const name = displayName.trim()
  if (!name) throw new Error('El nombre del atleta no puede estar vacío')

  const now = Date.now()
  const athlete: Athlete = {
    id: `ath_m_${uuid()}`,
    ownerAccountId,
    linkedAccountId: null,
    displayName: name,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }

  await db.athletes.put(athlete)
  void syncService.pushAthlete(athlete)

  return athlete
}

/** Active athletes owned by this account: self first, then by display name. */
export async function listOwnedAthletes(ownerAccountId: string): Promise<Athlete[]> {
  const selfId = athleteIdForOwner(ownerAccountId)
  const rows = await db.athletes.toArray()

  return rows
    .filter((row) => row.ownerAccountId === ownerAccountId && row.status === 'active')
    .sort((a, b) => {
      if (a.id === selfId) return -1
      if (b.id === selfId) return 1
      return (a.displayName ?? '').localeCompare(b.displayName ?? '')
    })
}
