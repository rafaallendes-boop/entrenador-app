import { db } from '../../db/db'
import { getAllAthleteScopedTables, purgeAthleteScopedRows } from '../../db/athleteScopedTables'
import type { Athlete } from '../../types'
import { v4 as uuid } from '../../utils/uuid'
import { clearStoredChatSessionIdForAthlete } from '../../utils/chatSession'
import * as syncService from '../syncService'
import { abortPlanGenerationForAthlete } from '../planBuilder/generationJobRunner'
import {
  clearAthleteDeleteTombstone,
  hasAthleteDeleteTombstone,
  rememberAthleteDeleteTombstone,
} from '../sync/athleteDeleteTombstones'
import { clearQueuedOpsForAthlete } from '../sync/syncQueue'
import { athleteIdForOwner } from './athleteScopeMigration'
import { clearCoachPlanningHydrationRegistry } from './coachPlanningHydrationRegistry'

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

/**
 * Hard eligibility gate for coach-managed lifecycle operations. A managed
 * athlete must belong to the owner, must not be the owner's self athlete, and
 * must not have been claimed by a linked account.
 */
export function assertEligibleManagedAthlete(ownerAccountId: string, athlete: Athlete): void {
  if (athlete.ownerAccountId !== ownerAccountId) {
    throw new Error('El atleta no pertenece a esta cuenta.')
  }
  if (athlete.id === athleteIdForOwner(ownerAccountId)) {
    throw new Error('No puedes archivar ni eliminar tu propio perfil.')
  }
  if (athlete.linkedAccountId != null) {
    throw new Error('Este atleta tiene una cuenta vinculada; no se puede archivar ni eliminar desde acá.')
  }
}

async function getEligibleManagedAthlete(ownerAccountId: string, athleteId: string): Promise<Athlete> {
  const athlete = await db.athletes.get(athleteId)
  if (!athlete) throw new Error('Atleta no encontrado.')
  assertEligibleManagedAthlete(ownerAccountId, athlete)
  return athlete
}

async function setManagedAthleteStatus(
  ownerAccountId: string,
  athleteId: string,
  status: 'active' | 'archived',
): Promise<Athlete> {
  const athlete = await getEligibleManagedAthlete(ownerAccountId, athleteId)
  const next: Athlete = { ...athlete, status, updatedAt: Date.now() }
  await db.athletes.put(next)
  try {
    await syncService.pushAthlete(next)
  } catch (error) {
    // Los fallos retriables ya quedan encolados dentro de syncService. Si el
    // push rechaza antes de ese punto, restaura el estado local y propaga.
    await db.athletes.put(athlete)
    throw error
  }
  return next
}

/** Archives a managed athlete without deleting any of their data. */
export async function archiveManagedAthlete(ownerAccountId: string, athleteId: string): Promise<Athlete> {
  return setManagedAthleteStatus(ownerAccountId, athleteId, 'archived')
}

/** Restores an archived managed athlete to the active roster. */
export async function restoreManagedAthlete(ownerAccountId: string, athleteId: string): Promise<Athlete> {
  return setManagedAthleteStatus(ownerAccountId, athleteId, 'active')
}

/** Archived managed athletes owned by this account, sorted by display name. */
export async function listArchivedAthletes(ownerAccountId: string): Promise<Athlete[]> {
  const rows = await db.athletes.toArray()
  return rows
    .filter((row) => row.ownerAccountId === ownerAccountId && row.status === 'archived')
    .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''))
}

/**
 * Permanently deletes an archived managed athlete in two phases.
 *
 * Phase A is reversible: acquire the exclusive barrier, persist this attempt's
 * tombstone, stop generation, drain athlete writes, then delete remotely (or
 * durably queue the canonical delete). Any failure rolls back only this
 * attempt's tombstone and leaves local data and queue untouched.
 *
 * Phase B is destructive: suppress stale queued writes, purge every
 * athlete-keyed Dexie table in one transaction, then remove scoped chat state.
 * The tombstone intentionally remains after success to prevent resurrection.
 */
export async function deleteManagedAthletePermanently(
  ownerAccountId: string,
  athleteId: string,
): Promise<void> {
  const athlete = await db.athletes.get(athleteId)
  if (!athlete) {
    if (hasAthleteDeleteTombstone(ownerAccountId, athleteId)) return
    throw new Error('Atleta no encontrado.')
  }
  assertEligibleManagedAthlete(ownerAccountId, athlete)
  if (athlete.status !== 'archived') {
    throw new Error('Solo se puede eliminar un atleta archivado.')
  }

  const releaseBarrier = syncService.acquireAthleteDeletionBarrier(athleteId)
  if (!releaseBarrier) throw new Error('Ya hay un borrado de este atleta en curso.')

  try {
    const tombstoneToken = rememberAthleteDeleteTombstone(ownerAccountId, athleteId)
    clearCoachPlanningHydrationRegistry(athleteId)
    const rollbackTombstone = () => {
      if (!clearAthleteDeleteTombstone(ownerAccountId, athleteId, tombstoneToken)) {
        throw new Error(
          'El borrado falló y además no se pudo desbloquear al atleta en este dispositivo. ' +
          'Sus datos están intactos; reintenta el borrado para destrabarlo.',
        )
      }
    }

    let remoteResult: Awaited<ReturnType<typeof syncService.deleteManagedAthleteRemote>>
    try {
      await abortPlanGenerationForAthlete(athleteId)
      await syncService.waitForInFlightAthleteOps(athleteId)
      remoteResult = await syncService.deleteManagedAthleteRemote(ownerAccountId, athleteId)
    } catch (error) {
      rollbackTombstone()
      throw error
    }

    if (remoteResult === 'failed') {
      rollbackTombstone()
      throw new Error('No se pudo eliminar el atleta en el servidor. No se borró nada local; intenta de nuevo.')
    }

    const legacySessionIds = await db.sessions.where('athleteId').equals(athleteId).primaryKeys()
    clearQueuedOpsForAthlete(ownerAccountId, athleteId, legacySessionIds.map(String))
    await db.transaction('rw', getAllAthleteScopedTables(), async () => {
      await purgeAthleteScopedRows(athleteId)
    })
    clearStoredChatSessionIdForAthlete(athleteId)
  } finally {
    releaseBarrier()
  }
}
