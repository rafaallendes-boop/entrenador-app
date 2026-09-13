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
import { clearCoachPlanningHydrationRegistry } from './coachPlanningHydrationRegistry'
import { listRosterEntries, resolveRosterAccess, resolveRosterEntry } from './coachRosterEligibility'
import { putLocalMembership } from './membershipCache'

/**
 * Alta de un gestionado (sin login: linkedAccountId queda null). Persiste local,
 * anticipa la membresía `coach` que `athletes_seed_membership` (013b) va a
 * sembrar en el insert remoto, y encola el push. Sigue por el insert del
 * cliente (`athletes_insert_bootstrap_owner`); el alta por RPC administrativa
 * es otra entrega.
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

  await db.transaction('rw', db.athletes, db.athleteMemberships, async () => {
    await db.athletes.put(athlete)
    await putLocalMembership(ownerAccountId, athlete.id, 'coach', true)
  })
  void syncService.pushAthlete(athlete)

  return athlete
}

/** Roster activo de la cuenta por membresía: self primero, luego por nombre. */
export async function listRosterAthletes(accountId: string): Promise<Athlete[]> {
  return (await listRosterEntries(accountId))
    .filter((entry) => entry.athlete.status === 'active')
    .map((entry) => entry.athlete)
}

/** Gestionados archivados sobre los que la cuenta tiene membresía coach. */
export async function listArchivedRosterAthletes(accountId: string): Promise<Athlete[]> {
  return (await listRosterEntries(accountId))
    .filter((entry) => entry.access === 'coach' && entry.athlete.status === 'archived')
    .map((entry) => entry.athlete)
}

/**
 * Gate duro del ciclo de vida de un gestionado. Ya no pregunta por el
 * propietario: pregunta por la membresía. Un self (propio) y un atleta con
 * cuenta vinculada quedan fuera, igual que antes.
 */
export async function assertEligibleManagedAthlete(accountId: string, athlete: Athlete): Promise<void> {
  const access = await resolveRosterAccess(accountId, athlete)
  if (!access) {
    throw new Error('El atleta no pertenece a esta cuenta.')
  }
  if (access === 'self') {
    throw new Error('No puedes archivar ni eliminar tu propio perfil.')
  }
  if (athlete.linkedAccountId != null) {
    throw new Error('Este atleta tiene una cuenta vinculada; no se puede archivar ni eliminar desde acá.')
  }
}

async function getEligibleManagedAthlete(accountId: string, athleteId: string): Promise<Athlete> {
  const entry = await resolveRosterEntry(accountId, athleteId)
  if (!entry) {
    const exists = await db.athletes.get(athleteId)
    throw new Error(exists ? 'El atleta no pertenece a esta cuenta.' : 'Atleta no encontrado.')
  }
  await assertEligibleManagedAthlete(accountId, entry.athlete)
  return entry.athlete
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
  await assertEligibleManagedAthlete(ownerAccountId, athlete)
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
