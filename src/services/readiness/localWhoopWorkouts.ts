import { db } from '../../db/db'
import type { WhoopWorkout } from '../../types'

/**
 * El índice de Dexie es `id, date, athleteId, updatedAt, &workoutId`: no hay
 * compuesto `[athleteId+date]`, así que se consulta por rango de `date` y se
 * filtra `athleteId` en memoria. El volumen es de decenas de filas.
 *
 * `WhoopWorkout.athleteId` es obligatorio en el tipo, así que no hay filas
 * legacy sin scope y el filtro es igualdad exacta: no aplica la política de
 * adopción legacy-self-only.
 */
export async function getLocalWhoopWorkoutsInRange(
  athleteId: string,
  startDate: string,
  endDate: string,
): Promise<WhoopWorkout[]> {
  const rows = await db.whoopWorkouts
    .where('date')
    .between(startDate, endDate, true, true)
    .toArray()

  return rows
    .filter((row) => row.athleteId === athleteId)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.workoutId.localeCompare(b.workoutId))
}
