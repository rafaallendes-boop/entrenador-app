import { db } from '../../db/db'
import type { ReadinessDaily } from '../../types'
import { getActiveAthleteId } from '../athlete/activeAthlete'

export async function getLocalReadinessForDate(
  athleteId: string,
  date: string,
  source = 'whoop',
): Promise<ReadinessDaily | undefined> {
  return db.readinessDaily
    .where('[athleteId+date+source]')
    .equals([athleteId, date, source])
    .first()
}

export async function clearLocalWhoopReadiness(athleteId = getActiveAthleteId()): Promise<void> {
  const rows = await db.readinessDaily.where('source').equals('whoop').toArray()
  const ids = rows
    .filter((row) => athleteId == null || row.athleteId === athleteId)
    .map((row) => row.id)
  if (ids.length > 0) await db.readinessDaily.bulkDelete(ids)
}
