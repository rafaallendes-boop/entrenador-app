import type { WeekSummary } from '../../types'

interface LoadIndicatorProps {
  summary: WeekSummary
}

export default function LoadIndicator({ summary }: LoadIndicatorProps) {
  const maxMinutes = 500
  const loadPct = Math.min((summary.completedMinutes / maxMinutes) * 100, 100)
  const adherencePct = Math.min(summary.adherencePct ?? 0, 100)

  const getLoadLabel = () => {
    if (loadPct < 30) return { label: 'Baja', color: 'text-teal-400' }
    if (loadPct < 60) return { label: 'Moderada', color: 'text-yellow-400' }
    if (loadPct < 85) return { label: 'Alta', color: 'text-orange-400' }
    return { label: 'Maxima', color: 'text-red-400' }
  }

  const { label, color } = getLoadLabel()

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-ink-muted font-medium">Carga semanal</span>
          <span className={`text-xs font-semibold ${color}`}>{label}</span>
        </div>
        <div className="mt-2 h-2 bg-surface-raised rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500"
            style={{ width: `${loadPct}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-ink-faint">
          <span>{summary.completedSessions} realizadas</span>
          <span>{Math.round(summary.completedMinutes / 60)}h {summary.completedMinutes % 60}min</span>
        </div>
      </div>

      {summary.adherencePct != null && summary.plannedSessions > 0 && (
        <div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-ink-muted font-medium">Adherencia semanal</span>
            <span className="text-xs font-semibold text-brand-light">{summary.adherencePct}%</span>
          </div>
          <div className="mt-2 h-1.5 bg-surface-raised rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-light transition-all duration-500"
              style={{ width: `${adherencePct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
