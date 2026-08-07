import { addDays } from 'date-fns'
import { getSessionsForDateRange } from '../../db/queries'
import { formatWhoopWorkoutBlock, WHOOP_WORKOUT_WINDOW_DAYS } from '../ai/whoopWorkoutContext'
import { fromISO, toISO } from '../../utils/date'
import { getLocalWhoopWorkoutsInRange } from './localWhoopWorkouts'

// La ventana es del formateador: acá solo se consulta el rango que él filtra.
const WINDOW_DAYS = WHOOP_WORKOUT_WINDOW_DAYS

/**
 * Arma el bloque de carga objetiva consultando LAS DOS colecciones sobre la
 * ventana `today - 6 … today`.
 *
 * Las sesiones NO salen del store del chat: ese contiene la semana cargada, así
 * que un lunes no tendría las del domingo y sus workouts saldrían marcados como
 * «sin sesion asociada» siendo falso.
 *
 * Si no hay workouts, corta antes de consultar sesiones: es el camino de un
 * atleta gestionado, que nunca tiene filas de Whoop.
 */
export async function loadWhoopWorkoutBlock(
  athleteId: string,
  today: string,
): Promise<string | null> {
  const windowStart = toISO(addDays(fromISO(today), -(WINDOW_DAYS - 1)))

  const workouts = await getLocalWhoopWorkoutsInRange(athleteId, windowStart, today)
  if (workouts.length === 0) return null

  const sessions = await getSessionsForDateRange(windowStart, today)
  return formatWhoopWorkoutBlock(workouts, sessions, today)
}
