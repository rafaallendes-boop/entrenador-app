import type { WhoopWorkout } from '../../types'
import { normalizeWhoopSportName } from './whoopSportMap'

/**
 * Whitelist explícita, misma forma que la allowlist de pliométricos y la de
 * drills competitivos de squash. Es la ÚNICA declaración de elegibilidad de
 * ritmo del proyecto: el bloque del coach la consume desde acá.
 */
const PACE_ELIGIBLE_SPORTS = new Set<string>(['running'])

/**
 * `distance_meter` puede traer un residuo de GPS en una sesión indoor; dividir
 * por eso produce un ritmo absurdo con aspecto de dato real.
 */
const MIN_PACE_DISTANCE_M = 300

const METERS_PER_KM = 1000

export type WorkoutMetric =
  | { key: 'strain'; value: number }                           // 0-21
  | { key: 'duration'; value: number }                         // minutos
  | { key: 'hr'; value: { avg: number; max: number | null } }  // bpm
  | { key: 'distance'; value: number }                         // metros
  | { key: 'pace'; value: number }                             // segundos por km, fraccional

export type WorkoutScoreNotice = 'pending' | 'unscorable' | null

/**
 * `durationMin` ya viene redondeado a minuto entero desde `normalizeWorkouts`,
 * y ese redondeo mueve el ritmo hasta ~1 s/km. El ritmo se calcula acá.
 *
 * `normalizeWorkouts` ya descarta `endMs <= startMs` del lado del servidor,
 * pero esta función recibe una fila de Dexie que pudo entrar por import o
 * backup, así que valida por su cuenta en vez de confiar en otro módulo.
 */
function exactDurationMs(workout: WhoopWorkout): number | null {
  const startMs = new Date(workout.startAt).getTime()
  const endMs = new Date(workout.endAt).getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  const durationMs = endMs - startMs
  return durationMs > 0 ? durationMs : null
}

export function resolvePaceSecondsPerKm(workout: WhoopWorkout): number | null {
  if (!PACE_ELIGIBLE_SPORTS.has(normalizeWhoopSportName(workout.sportName))) return null

  const distanceM = workout.distanceM
  if (distanceM == null || distanceM < MIN_PACE_DISTANCE_M) return null

  const durationMs = exactDurationMs(workout)
  if (durationMs == null) return null

  return (durationMs / 1000) / (distanceM / METERS_PER_KM)
}

export function buildWorkoutMetrics(workout: WhoopWorkout): WorkoutMetric[] {
  const metrics: WorkoutMetric[] = []

  if (workout.strain != null) metrics.push({ key: 'strain', value: workout.strain })
  metrics.push({ key: 'duration', value: workout.durationMin })
  if (workout.avgHr != null) {
    metrics.push({ key: 'hr', value: { avg: workout.avgHr, max: workout.maxHr ?? null } })
  }
  if (workout.distanceM != null) metrics.push({ key: 'distance', value: workout.distanceM })

  const pace = resolvePaceSecondsPerKm(workout)
  if (pace != null) metrics.push({ key: 'pace', value: pace })

  return metrics
}

/**
 * `PENDING_SCORE` es transitorio y `UNSCORABLE` es terminal: no se colapsan,
 * porque decirle «todavía» a algo que nunca va a llegar le miente al usuario
 * que vuelve a mirar mañana. Con `SCORED` y métricas faltantes no se dice nada:
 * no se infiere procesamiento a partir de una ausencia.
 */
export function resolveScoreNotice(workout: WhoopWorkout): WorkoutScoreNotice {
  if (workout.scoreState === 'PENDING_SCORE') return 'pending'
  if (workout.scoreState === 'UNSCORABLE') return 'unscorable'
  return null
}
