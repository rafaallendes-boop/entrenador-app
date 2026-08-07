import { subDays } from 'date-fns'
import type { Session, WhoopWorkout } from '../../types'
import { fromISO, toISO } from '../../utils/date'
import { buildWorkoutMetrics, type WorkoutMetric } from '../readiness/workoutMetrics'

/**
 * Ventana del bloque, en días calendario inclusive. Se exporta porque el
 * orquestador consulta Dexie sobre exactamente este rango: si el fetch y el
 * filtro fueran constantes independientes, ampliar una sola truncaría en
 * silencio (filtro más angosto) o pediría de menos (fetch más angosto), y
 * ningún test lo notaría mientras coincidieran por casualidad.
 */
export const WHOOP_WORKOUT_WINDOW_DAYS = 7
const WINDOW_DAYS = WHOOP_WORKOUT_WINDOW_DAYS
const MAX_DETAILED_LINES = 8

/** Orden de lectura de la línea, independiente del orden de emisión del módulo puro. */
const LINE_ORDER: WorkoutMetric['key'][] = ['duration', 'strain', 'hr', 'distance', 'pace']

const GUARD_LINE =
  'Strain es carga fisiologica medida (0-21), no el esfuerzo declarado por el atleta.'

const MAX_TITLE_CHARS = 48
const MAX_SPORT_CHARS = 24

/**
 * Sin tope por campo, «8 líneas» no es un límite de tokens: un título de sesión
 * es texto libre del usuario y puede traer saltos de línea que además romperían
 * la estructura del bloque.
 */
function sanitizeField(value: string, maxChars: number): string {
  const flattened = value.replace(/\s+/g, ' ').trim()
  return flattened.length > maxChars ? `${flattened.slice(0, maxChars - 1)}…` : flattened
}

function formatDayLabel(date: string): string {
  return `${date.slice(8, 10)}-${date.slice(5, 7)}`
}

function formatPaceCompact(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}/km`
}

function formatMetricPart(metric: WorkoutMetric): string {
  switch (metric.key) {
    case 'duration':
      return `${Math.round(metric.value)} min`
    case 'strain':
      return `strain ${metric.value.toFixed(1)}`
    case 'hr':
      return metric.value.max != null
        ? `FC ${Math.round(metric.value.avg)}/${Math.round(metric.value.max)}`
        : `FC ${Math.round(metric.value.avg)}`
    case 'distance':
      return `${(metric.value / 1000).toFixed(1).replace('.', ',')} km`
    case 'pace':
      return formatPaceCompact(metric.value)
  }
}

function formatWorkoutLine(workout: WhoopWorkout, session: Session | undefined): string {
  const sport = sanitizeField(workout.sportName, MAX_SPORT_CHARS)
  const parts = [`${formatDayLabel(workout.date)} ${sport}`]
  const metrics = [...buildWorkoutMetrics(workout)]
    .sort((a, b) => LINE_ORDER.indexOf(a.key) - LINE_ORDER.indexOf(b.key))
  for (const metric of metrics) parts.push(formatMetricPart(metric))

  const tail = session
    ? `sesion planificada: ${sanitizeField(session.title, MAX_TITLE_CHARS)} ${Math.round(session.durationMin)} min`
    : 'sin sesion asociada'

  return `- ${parts.join(' · ')} → ${tail}`
}

/**
 * `today` se inyecta: nada de `Date.now()` acá.
 *
 * La ventana compara el campo `date` como string `YYYY-MM-DD`, no los
 * timestamps: `normalizeWhoop` ya resolvió el día calendario local aplicando el
 * `timezone_offset` de Whoop, así que nunca se construye un instante y la
 * ambigüedad de huso horario desaparece de raíz.
 */
export function formatWhoopWorkoutBlock(
  workouts: WhoopWorkout[],
  sessions: Session[],
  today: string,
): string | null {
  const startDate = toISO(subDays(fromISO(today), WINDOW_DAYS - 1))

  const inWindow = workouts
    .filter((workout) =>
      workout.scoreState === 'SCORED'
      && workout.date >= startDate
      && workout.date <= today)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.workoutId.localeCompare(b.workoutId))

  if (inWindow.length === 0) return null

  const sessionByWorkoutId = new Map<string, Session>()
  for (const session of sessions) {
    const workoutId = session.autoCompletion?.workoutId
    if (workoutId) sessionByWorkoutId.set(workoutId, session)
  }

  const detailed = inWindow.slice(-MAX_DETAILED_LINES)
  const overflow = inWindow.slice(0, inWindow.length - detailed.length)

  const lines = [`Carga objetiva registrada por Whoop (ultimos ${WINDOW_DAYS} dias):`]

  // Va antes de las detalladas: resume los MÁS VIEJOS, y la lista crece hacia
  // abajo en orden cronológico ascendente.
  if (overflow.length > 0) {
    const totalMin = Math.round(
      overflow.reduce((sum, workout) => sum + workout.durationMin, 0),
    )
    lines.push(`+${overflow.length} entrenamientos anteriores no detallados (${totalMin} min en total)`)
  }

  for (const workout of detailed) {
    lines.push(formatWorkoutLine(workout, sessionByWorkoutId.get(workout.workoutId)))
  }

  lines.push(GUARD_LINE)
  return lines.join('\n')
}
