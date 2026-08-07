import type { Session, WhoopWorkout } from '../../types'
import { fromISO, getWeekStart, toISO } from '../../utils/date'

/**
 * ¿Ya se puede afirmar que un workout NO está asociado?
 *
 * «No asociado» es una afirmación sobre las sesiones, no sobre el workout, así
 * que exige tener las sesiones del día. El store las carga por semana en un
 * efecto, mientras que los workouts salen de un índice puntual de Dexie y ganan
 * la carrera: sin esta guardia, un workout que sí completó una sesión aparece un
 * instante como residual. Una lista vacía porque todavía no cargó es
 * indistinguible de una lista vacía de verdad — por eso se pregunta por la
 * semana cargada y no por la cantidad de sesiones.
 */
export function canResolveWorkoutClaims(
  dateISO: string,
  loadedWeekStart: string | null,
): boolean {
  if (!dateISO || !loadedWeekStart) return false
  return loadedWeekStart === toISO(getWeekStart(fromISO(dateISO)))
}

/**
 * Workouts del día que ninguna sesión reclamó.
 *
 * La autoridad es el lado de la sesión: `types/index.ts:493-494` declara que
 * `workout.autoComplete.status` es estado local y que la fuente durable es
 * `session.autoCompletion.workoutId`. Si divergen, gana la sesión.
 */
export function selectUnclaimedWorkouts(
  workouts: WhoopWorkout[],
  sessions: Session[],
): WhoopWorkout[] {
  const claimed = new Set(
    sessions
      .map((session) => session.autoCompletion?.workoutId)
      .filter((workoutId): workoutId is string => Boolean(workoutId)),
  )
  return workouts.filter((workout) => !claimed.has(workout.workoutId))
}
