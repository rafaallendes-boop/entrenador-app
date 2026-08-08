import { subDays } from 'date-fns'
import type { Session, WhoopWorkout } from '../../types'
import { fromISO, toISO } from '../../utils/date'
import {
  buildWorkoutMetrics,
  formatHrCapturePercent,
  resolveHighZoneDurationMs,
  resolveHrCaptureState,
  type WorkoutMetric,
} from '../readiness/workoutMetrics'

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

/**
 * Texto del spec §6, restaurado literalmente.
 *
 * Se probó una versión corta —«No propongas objetivos por zona: el producto no
 * los tiene»— para ahorrar los ~17 tokens fijos que cuesta la diferencia. Se
 * revirtió: conservaba la prohibición pero perdía la **premisa**, que las zonas
 * son distribución *medida*. Sin esa palabra el modelo puede leer los minutos
 * por zona como una prescripción a cumplir en vez de como una observación de lo
 * que ya pasó, y la primera frase solo declara medido el strain.
 */
const GUARD_LINE =
  'Strain es carga fisiologica medida (0-21), no el esfuerzo declarado por el atleta. '
  + 'Las zonas son distribucion de FC medida: no propongas objetivos por zona, '
  + 'el producto no tiene sesiones con objetivo de zona.'

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

  // `LINE_ORDER` pone `strain` antes de `hr`, así que para que la zona alta caiga
  // entre ambos hay que insertarla por posición, no por append.
  const highZoneMs = resolveHighZoneDurationMs(workout)
  if (highZoneMs != null) {
    const hrIndex = parts.findIndex((part) => part.startsWith('FC '))
    const segment = `${Math.round(highZoneMs / 60_000)} min zona alta`
    if (hrIndex === -1) parts.push(segment)
    else parts.splice(hrIndex, 0, segment)
  }

  const capture = resolveHrCaptureState(workout)
  // `full` y `high` no agregan nada: entre 90 y 100 la distribución es
  // utilizable y gastar tokens en decirlo no cambia ninguna lectura. `null`
  // tampoco: sin distribución no hay nada que calificar.
  if (capture?.kind === 'low') {
    parts.push(`cobertura ${formatHrCapturePercent(capture.percent, '.')}%`)
  } else if (capture?.kind === 'unknown') {
    // `cobertura ?` y no «cobertura no informada»: es el caso que puede repetirse
    // en las ocho líneas, y la frase larga costaba 50 tokens por bloque para
    // decir lo mismo que el signo de pregunta junto a una métrica ya nombrada.
    parts.push('cobertura ?')
  }

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
