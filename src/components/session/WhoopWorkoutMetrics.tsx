import type { WhoopWorkout } from '../../types'
import {
  buildWorkoutMetrics,
  resolveScoreNotice,
  type WorkoutMetric,
} from '../../services/readiness/workoutMetrics'

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

  return (
    // Los márgenes laterales igualan el padding de la cabecera de la tarjeta
    // (`p-3 md:p-4`): sin ellos el recuadro sale a sangre y su borde redondeado
    // choca con el de la tarjeta. El margen inferior lo separa del borde de la
    // tarjeta plegada y del divisor del cuerpo expandido.
    <div className="mx-3 mb-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 md:mx-4 md:mb-4">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {metrics.map((metric) => {
          const { label, value } = formatMetric(metric)
          return (
            <div key={metric.key} className="min-w-0">
              <p className="font-mono text-sm font-semibold tabular-nums text-ink">{value}</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">{label}</p>
            </div>
          )
        })}
      </div>
      {notice && <p className="mt-2 text-[11px] text-ink-muted">{SCORE_NOTICE_TEXT[notice]}</p>}
    </div>
  )
}
