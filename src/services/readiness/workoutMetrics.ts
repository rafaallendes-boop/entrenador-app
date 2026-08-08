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

export const HR_ZONE_KEYS = ['z0', 'z1', 'z2', 'z3', 'z4', 'z5'] as const

export type HrZoneKey = (typeof HR_ZONE_KEYS)[number]

/** Etiqueta compacta para gráficos y leyendas. */
export const HR_ZONE_LABELS: Record<HrZoneKey, string> = {
  z0: 'Z0', z1: 'Z1', z2: 'Z2', z3: 'Z3', z4: 'Z4', z5: 'Z5',
}

/** Nombre hablado, para texto accesible. Whoop no publica nombres por zona. */
export const HR_ZONE_ACCESSIBLE_LABELS: Record<HrZoneKey, string> = {
  z0: 'zona 0', z1: 'zona 1', z2: 'zona 2',
  z3: 'zona 3', z4: 'zona 4', z5: 'zona 5',
}

/**
 * Zonas que cuentan como «alta»: lo estrictamente por encima de Z3.
 *
 * Es la ÚNICA declaración del umbral. La suma de abajo itera sobre esta lista en
 * vez de escribir `z4 + z5` a mano, y la leyenda dibuja su corchete a partir de
 * ella: si el umbral se moviera, cálculo y color se mueven juntos o no se mueve
 * ninguno. Con dos literales independientes —uno acá y otro en la capa de
 * presentación— el corchete podía marcar un tramo que la cifra no contaba.
 */
export const HIGH_ZONE_KEYS: readonly HrZoneKey[] = ['z4', 'z5']

/**
 * Zona alta = suma de `HIGH_ZONE_KEYS`.
 *
 * ÚNICA declaración del proyecto. El precedente es `WINDOW_DAYS` declarado dos
 * veces en la Entrega 2: tres superficies con tres umbrales distintos de «duro»
 * darían tres respuestas a la misma pregunta.
 *
 * Devuelve milisegundos SIN redondear; cada superficie convierte una sola vez,
 * en su borde de presentación.
 */
export function resolveHighZoneDurationMs(workout: WhoopWorkout): number | null {
  const zones = workout.zoneDurations
  if (!zones) return null
  return HIGH_ZONE_KEYS.reduce((total, key) => total + zones[key], 0)
}

/** Umbral VISUAL y solo visual: no descarta zonas ni altera ningún agregado. */
export const LOW_HR_CAPTURE_NOTICE_THRESHOLD = 90

export type HrCaptureState =
  | { kind: 'unknown' }
  | { kind: 'full' }
  | { kind: 'high'; percent: number }
  | { kind: 'low'; percent: number }

/**
 * Devuelve `null` cuando no hay distribución, aunque `percentRecorded` esté
 * presente: la cobertura califica un reparto, y sin reparto no califica nada.
 * Si devolviera `unknown` ante la mera ausencia de porcentaje, todo
 * entrenamiento anterior al flag caería en esa rama y el coach le agregaría
 * «cobertura no informada» a algo que ni siquiera tiene distribución.
 */
export function resolveHrCaptureState(workout: WhoopWorkout): HrCaptureState | null {
  if (!workout.zoneDurations) return null

  const percent = workout.percentRecorded
  if (percent == null) return { kind: 'unknown' }
  if (percent >= 100) return { kind: 'full' }
  if (percent >= LOW_HR_CAPTURE_NOTICE_THRESHOLD) return { kind: 'high', percent }
  return { kind: 'low', percent }
}

/**
 * TRUNCA a un decimal; no redondea. El truncamiento es la única operación que
 * preserva la clasificación: redondear 89,96 daría «90,0» junto a un aviso de
 * cobertura baja.
 */
export function formatHrCapturePercent(percent: number, decimalSeparator: '.' | ','): string {
  const truncated = Math.floor(percent * 10) / 10
  return String(truncated).replace('.', decimalSeparator)
}
