import type { WhoopWorkout } from '../../types'
import {
  buildWorkoutMetrics,
  resolveHighZoneDurationMs,
  resolveScoreNotice,
  type WorkoutMetric,
} from '../../services/readiness/workoutMetrics'
import HrZoneDistribution from './HrZoneDistribution'
import { HR_ZONE_RAMP } from '../ui/hrZoneScale'

const SCORE_NOTICE_TEXT = {
  pending: 'Whoop todavía no puntuó este entrenamiento',
  unscorable: 'Whoop no pudo puntuar este entrenamiento',
} as const

/** El valor crudo es fraccional; el redondeo a segundo entero vive acá. */
function formatPace(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')} /km`
}

function formatMetric(metric: WorkoutMetric): { label: string; value: string } {
  switch (metric.key) {
    case 'strain':
      return { label: 'Strain', value: metric.value.toFixed(1) }
    case 'duration':
      return { label: 'Duración', value: `${Math.round(metric.value)} min` }
    case 'hr':
      return {
        label: 'FC',
        value: metric.value.max != null
          ? `${Math.round(metric.value.avg)} / ${Math.round(metric.value.max)} bpm`
          : `${Math.round(metric.value.avg)} bpm`,
      }
    case 'distance':
      return { label: 'Distancia', value: `${(metric.value / 1000).toFixed(2).replace('.', ',')} km` }
    case 'pace':
      return { label: 'Ritmo', value: formatPace(metric.value) }
  }
}

export default function WhoopWorkoutMetrics({ workout }: { workout: WhoopWorkout }) {
  const metrics = buildWorkoutMetrics(workout)
  const notice = resolveScoreNotice(workout)
  const highZoneMs = resolveHighZoneDurationMs(workout)

  return (
    // Los márgenes laterales igualan el padding de la cabecera de la tarjeta
    // (`p-3 md:p-4`): sin ellos el recuadro sale a sangre y su borde redondeado
    // choca con el de la tarjeta. El margen inferior lo separa del borde de la
    // tarjeta plegada y del divisor del cuerpo expandido.
    <div className="mx-3 mb-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 md:mx-4 md:mb-4">
      {/* La grilla aplica a TODAS las tarjetas, con zonas o sin ellas: la
          alternativa —grilla solo cuando hay zonas— dejaría dos layouts que
          mantener y una tarjeta que se reacomoda sola cuando Whoop termina de
          puntuar. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
        {metrics.map((metric) => {
          const { label, value } = formatMetric(metric)
          return (
            <div key={metric.key} className="min-w-0">
              <p className="font-mono text-sm font-semibold tabular-nums text-ink">{value}</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">{label}</p>
            </div>
          )
        })}
        {highZoneMs != null && (
          <div className="min-w-0">
            {/* El número va en `text-ink` como los otros tres: las cuatro métricas
                son pares y pintar una de color diría que importa más. La identidad
                la lleva el cuadrito, que es el paso más alto de la misma rampa que
                enciende la barra de abajo — así se ve de dónde sale la cifra. */}
            <p className="font-mono text-sm font-semibold tabular-nums text-ink">
              {Math.round(highZoneMs / 60_000)} min
            </p>
            {/* El cuadrito va DENTRO del flujo del texto, no como hermano flex:
                si la etiqueta envuelve, acompaña a la primera línea en vez de
                quedar solo en la suya. */}
            <p className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              <span
                aria-hidden="true"
                className="mr-1 inline-block h-1.5 w-1.5 rounded-[1px] align-middle"
                style={{ backgroundColor: HR_ZONE_RAMP.z5 }}
              />
              Zona alta
            </p>
          </div>
        )}
      </div>
      <HrZoneDistribution workout={workout} />
      {notice && <p className="mt-2 text-[11px] text-ink-muted">{SCORE_NOTICE_TEXT[notice]}</p>}
    </div>
  )
}
