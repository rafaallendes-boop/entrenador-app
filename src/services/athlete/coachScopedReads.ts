/**
 * Lecturas multi-atleta por athleteId explicito para el Coach Workspace.
 *
 * Esta es una excepcion deliberada a activeScopeFilter: el modulo nunca lee ni
 * modifica el atleta activo. Las filas legacy sin athleteId pertenecen solo al
 * atleta self del owner.
 */
import { addDays, format, parseISO } from 'date-fns'
import { db } from '../../db/db'
import type { Athlete, Session } from '../../types'
import { athleteIdForOwner } from './athleteScopeMigration'
import { isScopedAthleteId } from './effectiveAthleteKey'
import { pullWeekSessionsForAthlete } from '../syncService'

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

export function weekEndISO(weekStartDate: string): string {
  return format(addDays(parseISO(weekStartDate), 6), 'yyyy-MM-dd')
}

/** Lectura pura Dexie de las sesiones semanales de un atleta del roster. */
export async function getWeekSessionsForAthlete(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
): Promise<Session[]> {
  await assertRosterAthlete(ownerAccountId, athleteId)
  const isSelf = athleteId === athleteIdForOwner(ownerAccountId)
  const rows = await db.sessions
    .where('date')
    .between(weekStartDate, weekEndISO(weekStartDate), true, true)
    .toArray()

  return rows
    .filter((row) => row.athleteId === athleteId || (!isScopedAthleteId(row.athleteId) && isSelf))
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

/** Hydrates one explicit roster athlete without changing the active scope. */
export async function hydrateWeekForAthlete(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
): Promise<void> {
  await assertRosterAthlete(ownerAccountId, athleteId)
  await pullWeekSessionsForAthlete(
    ownerAccountId,
    athleteId,
    weekStartDate,
    weekEndISO(weekStartDate),
    { includeLegacy: athleteId === athleteIdForOwner(ownerAccountId) },
  )
}
