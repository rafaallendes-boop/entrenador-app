import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { WhoopWorkout } from '../../types'
import {
  HR_ZONE_ACCESSIBLE_LABELS,
  HR_ZONE_KEYS,
  HR_ZONE_LABELS,
  formatHrCapturePercent,
  resolveHrCaptureState,
} from '../../services/readiness/workoutMetrics'
import { HR_ZONE_RAMP, isHighZone, zoneShare } from '../ui/hrZoneScale'
import HrZoneScaleLegend from '../ui/HrZoneScaleLegend'

/**
 * Redondeo al segundo. No es el dato intacto, pero conserva cada minuto entero.
 *
 * Sin `export`: la regla `react-refresh/only-export-components` del repo prohíbe
 * exportar no-componentes desde un archivo de componente, y nadie fuera de acá
 * la necesita. Si algún día hiciera falta, va a `workoutMetrics.ts`.
 */
function formatZoneDuration(milli: number): string {
  const totalSeconds = Math.round(milli / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function accessibleDuration(milli: number): string {
  const totalSeconds = Math.round(milli / 1000)
  return `${Math.floor(totalSeconds / 60)} minutos ${totalSeconds % 60} segundos`
}

export default function HrZoneDistribution({ workout }: { workout: WhoopWorkout }) {
  const [expanded, setExpanded] = useState(false)
  const zones = workout.zoneDurations
  if (!zones) return null

  const total = HR_ZONE_KEYS.reduce((sum, key) => sum + zones[key], 0)
  const capture = resolveHrCaptureState(workout)
  const accessibleSummary = HR_ZONE_KEYS
    .map((key) => `${HR_ZONE_ACCESSIBLE_LABELS[key]}: ${accessibleDuration(zones[key])}`)
    .join(', ')

  return (
    <div className="mt-3">
      {/* La barra es decorativa: `role="img"` + `aria-label` la hacen legible sin
          ver los colores.

          Los segmentos se reparten con `flexGrow` sobre `flex-basis: 0` y no con
          `width: %`: así los 2px de separación se descuentan primero y el reparto
          proporcional se hace sobre lo que queda, en vez de desbordar el ancho.
          Un segmento en cero se omite entero — si se renderizara, seguiría
          consumiendo su separación y abriría un hueco que no representa nada. */}
      <div
        role="img"
        aria-label={accessibleSummary}
        className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-white/[0.04]"
      >
        {HR_ZONE_KEYS.map((key) => (
          zones[key] > 0 && (
            <div
              key={key}
              title={`${HR_ZONE_LABELS[key]} · ${formatZoneDuration(zones[key])} · ${zoneShare(zones[key], total)}`}
              className="min-w-[2px] basis-0"
              style={{ flexGrow: zones[key], backgroundColor: HR_ZONE_RAMP[key] }}
            />
          )
        ))}
      </div>

      {capture?.kind === 'low' && (
        <p className="mt-1.5 text-[11px] text-amber-300/80">
          Cobertura de medición Whoop: {formatHrCapturePercent(capture.percent, ',')}%
        </p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="mt-2 flex w-full items-center justify-between border-t border-white/5 pt-2 text-[11px] text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60 motion-reduce:transition-none"
      >
        <span>Distribución por zona</span>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {expanded && (
        <>
          {/* Las barras por fila no repiten la barra apilada: comparten una misma
              base, así que dejan comparar zonas entre sí, que es justo lo que una
              barra apilada no permite. */}
          <ul className="mt-2 space-y-1">
            {[...HR_ZONE_KEYS].reverse().map((key) => (
              <li key={key} className="flex items-center gap-2">
                <span
                  className={`w-6 font-mono text-[11px] ${isHighZone(key) ? 'text-ink-muted' : 'text-ink-faint'}`}
                >
                  {HR_ZONE_LABELS[key]}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(zones[key] / total) * 100}%`,
                      backgroundColor: HR_ZONE_RAMP[key],
                    }}
                  />
                </span>
                <span className="w-8 text-right font-mono text-[11px] tabular-nums text-ink-faint">
                  {zoneShare(zones[key], total)}
                </span>
                <span className="w-10 text-right font-mono text-[11px] tabular-nums text-ink-muted">
                  {formatZoneDuration(zones[key])}
                </span>
              </li>
            ))}
          </ul>

          <HrZoneScaleLegend className="mt-3 border-t border-white/5 pt-3" />

          {capture?.kind === 'high' && (
            <p className="mt-2 text-[11px] text-ink-faint">
              Cobertura de medición Whoop: {formatHrCapturePercent(capture.percent, ',')}%
            </p>
          )}
          {capture?.kind === 'unknown' && (
            <p className="mt-2 text-[11px] text-ink-faint">Cobertura de medición no informada</p>
          )}
        </>
      )}
    </div>
  )
}
