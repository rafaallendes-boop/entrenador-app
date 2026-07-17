/**
 * Lecturas multi-atleta por athleteId explicito para el Coach Workspace.
 *
 * Esta es una excepcion deliberada a activeScopeFilter: el modulo nunca lee ni
 * modifica el atleta activo. Las filas legacy sin athleteId pertenecen solo al
 * atleta self del owner.
 */
import { addDays, format, parseISO } from 'date-fns'
import { db } from '../../db/db'
import type { Athlete, AthleteProfile, Session } from '../../types'
import { ATHLETE_PROFILE_LOCAL_ID } from './activeAthlete'
import { resolveSelfAthleteIdForOwner } from './athleteWeekScope'
import { isScopedAthleteId } from './effectiveAthleteKey'

export async function assertRosterAthlete(
  ownerAccountId: string,
  athleteId: string,
): Promise<Athlete> {
  const athlete = await db.athletes.get(athleteId)
  if (!athlete || athlete.ownerAccountId !== ownerAccountId) {
    throw new Error('El atleta no pertenece a tu roster.')
  }
  return athlete
}

export async function assertActiveRosterAthlete(
  ownerAccountId: string,
  athleteId: string,
): Promise<Athlete> {
  const athlete = await assertRosterAthlete(ownerAccountId, athleteId)
  if (athlete.status !== 'active') {
    throw new Error('Este atleta está archivado; restauralo para editar su semana.')
  }
  return athlete
}

export async function getAthleteProfileForAthlete(
  ownerAccountId: string,
  athleteId: string,
): Promise<AthleteProfile | undefined> {
  const selfId = await resolveSelfAthleteIdForOwner(ownerAccountId)
  if (athleteId === selfId) {
    const defaultRow = await db.athleteProfiles.get(ATHLETE_PROFILE_LOCAL_ID)
    if (defaultRow) return defaultRow
    return db.athleteProfiles.where('athleteId').equals(athleteId).first()
  }
  return (await db.athleteProfiles.where('athleteId').equals(athleteId).first())
    ?? db.athleteProfiles.get(athleteId)
}

export function weekEndISO(weekStartDate: string): string {
  return format(addDays(parseISO(weekStartDate), 6), 'yyyy-MM-dd')
}

/** Lectura pura Dexie de las sesiones semanales de un atleta del roster. */
export async function getWeekSessionsForAthlete(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
): Promise<Session[]> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const isSelf = athleteId === await resolveSelfAthleteIdForOwner(ownerAccountId)
  const rows = await db.sessions
    .where('date')
    .between(weekStartDate, weekEndISO(weekStartDate), true, true)
    .toArray()

  return rows
    .filter((row) => row.athleteId === athleteId || (!isScopedAthleteId(row.athleteId) && isSelf))
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}
