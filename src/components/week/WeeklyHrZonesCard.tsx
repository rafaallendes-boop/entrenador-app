import { useEffect, useState } from 'react'
import Card from '../ui/Card'
import { getActiveAthleteId, getSelfAthleteId } from '../../services/athlete/activeAthlete'
import { getLocalWhoopWorkoutsInRange } from '../../services/readiness/localWhoopWorkouts'
import {
  buildWeeklyHrZoneSummary,
  type WeeklyHrZoneSummary,
} from '../../services/readiness/weeklyHrZones'
import { HR_ZONE_ACCESSIBLE_LABELS, HR_ZONE_KEYS } from '../../services/readiness/workoutMetrics'
import { HR_ZONE_RAMP } from '../ui/hrZoneScale'
import HrZoneScaleLegend from '../ui/HrZoneScaleLegend'

/** Alto del área de columnas, en px. La banda de días va FUERA de esta caja. */
const PLOT_HEIGHT = 88

/**
 * Alto mínimo de un día CON datos. Tiene que ser mayor que `EMPTY_DAY_HEIGHT`:
 * si ambos midieran lo mismo, un día sin entrenar y un día de un minuto se
 * dibujarían idénticos y el gráfico mentiría en el caso más fácil de mirar.
 */
const MIN_COLUMN_HEIGHT = 6

/** Día sin datos: una línea de base, no una columna. Dice «existe, no hubo». */
const EMPTY_DAY_HEIGHT = 2

/**
 * Inicial en español por día de la semana, indexada por `Date.getDay()`
 * (0 = domingo). Se deriva de la fecha y no de la posición: la lista anterior
 * asumía que la semana empieza el lunes y además repetía «M» para martes y
 * miércoles, así que dos columnas quedaban con la misma etiqueta. La X de
 * miércoles es la desambiguación habitual en español.
 */
const DAY_INITIAL = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

function dayInitial(date: string): string {
  // Mediodía local: construir el día a las 00:00 lo deja expuesto a que un huso
  // negativo lo corra al día anterior.
  return DAY_INITIAL[new Date(`${date}T12:00:00`).getDay()]
}

interface LoadedState {
  athleteId: string
  weekStart: string
  summary: WeeklyHrZoneSummary | null
}

export default function WeeklyHrZonesCard({ weekDays }: { weekDays: string[] }) {
  const [state, setState] = useState<LoadedState | null>(null)
  const weekStart = weekDays[0]

  useEffect(() => {
    let cancelled = false

    async function load() {
      const athleteId = getActiveAthleteId()
      // Solo self: la ingestión pertenece siempre al self de la cuenta, así que
      // un gestionado nunca tiene filas y la consulta sería trabajo perdido.
      if (!athleteId || athleteId !== getSelfAthleteId()) {
        if (!cancelled) setState(null)
        return
      }

      const workouts = await getLocalWhoopWorkoutsInRange(
        athleteId, weekStart, weekDays[weekDays.length - 1],
      ).catch(() => [])

      // La identidad se compara al escribir, no solo al leer: `setCurrentWeekStart`
      // no desmonta la página (`AppShell` la remonta por `activeAthleteId`, no por
      // semana), así que una lectura de la semana N que resuelve después de pasar
      // a la N+1 pintaría datos de la semana equivocada.
      if (cancelled) return
      setState({
        athleteId,
        weekStart,
        summary: buildWeeklyHrZoneSummary(workouts, weekDays),
      })
    }

    void load()
    return () => { cancelled = true }
  }, [weekStart, weekDays])

  if (!state || state.weekStart !== weekStart || state.athleteId !== getActiveAthleteId()) return null

  const summary = state.summary
  if (!summary) return null

  // Escala única para las siete columnas: normalizar cada día por separado haría
  // que un día de 20 min y uno de 90 se vieran igual de altos, ocultando la
  // diferencia de volumen que el gráfico existe para mostrar.
  const scaleMs = Math.max(...summary.days.map((day) => day.totalMs), 1)

  const coverage: string[] = []
  if (summary.lowCaptureCount > 0) {
    coverage.push(`${summary.lowCaptureCount} con cobertura menor a 90%`)
  }
  if (summary.unknownCaptureCount > 0) {
    coverage.push(`${summary.unknownCaptureCount} sin cobertura informada`)
  }

  const subtitle = [
    `${summary.workoutCount} ${summary.workoutCount === 1 ? 'entrenamiento' : 'entrenamientos'}`,
    `${Math.round(summary.totalRecordedMs / 60_000)} min registrados`,
    ...coverage,
  ].join(' · ')

  return (
    <Card variant="panel" className="px-3 py-3 md:px-4 md:py-4">
      <p className="font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
        Carga medida por Whoop
      </p>
      {/* Sin cuadrito de color acá: en dos líneas quedaba descolgado del texto, y
          la escala ya la enseñan el gráfico y la leyenda de abajo. El titular es
          una cifra, y va en tinta como cualquier otra. */}
      <p className="mt-1 font-mono text-base font-semibold leading-snug tabular-nums text-ink [text-wrap:balance]">
        {Math.round(summary.highZoneMs / 60_000)} min registrados en zona alta
      </p>
      <p data-testid="weekly-hr-zones-subtitle" className="mt-0.5 text-[11px] text-ink-muted">
        {subtitle}
      </p>

      {/* El alto fijo es del área de columnas solamente. Antes la banda de días
          vivía dentro de la misma caja de `h-24`, así que el gráfico se quedaba
          con lo que sobraba de la etiqueta y la escala no era la declarada. */}
      <div className="mt-3 flex items-end gap-1.5" style={{ height: PLOT_HEIGHT }}>
        {summary.days.map((day) => (
          <div
            key={day.date}
            role="img"
            aria-label={day.totalMs === 0
              ? `${day.date}: sin datos Whoop`
              : `${day.date}: ${HR_ZONE_KEYS
                  .filter((key) => day.byZone[key] > 0)
                  .map((key) => `${HR_ZONE_ACCESSIBLE_LABELS[key]} ${Math.round(day.byZone[key] / 60_000)} min`)
                  .join(', ')}`}
            className={`flex flex-1 flex-col-reverse gap-[2px] overflow-hidden rounded-[3px] ${
              day.totalMs === 0 ? 'bg-white/[0.07]' : 'bg-white/[0.04]'
            }`}
            style={{
              height: day.totalMs === 0
                ? EMPTY_DAY_HEIGHT
                : Math.max((day.totalMs / scaleMs) * PLOT_HEIGHT, MIN_COLUMN_HEIGHT),
            }}
          >
            {HR_ZONE_KEYS.map((key) => (
              day.byZone[key] > 0 && (
                <div
                  key={key}
                  className="min-h-[2px] basis-0"
                  style={{ flexGrow: day.byZone[key], backgroundColor: HR_ZONE_RAMP[key] }}
                />
              )
            ))}
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex gap-1.5" aria-hidden="true">
        {summary.days.map((day) => (
          <span key={day.date} className="flex-1 text-center font-mono text-[10px] text-ink-faint">
            {dayInitial(day.date)}
          </span>
        ))}
      </div>

      <HrZoneScaleLegend className="mt-3 border-t border-white/5 pt-3" />
    </Card>
  )
}
