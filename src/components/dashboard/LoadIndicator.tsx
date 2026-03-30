import type { WeekSummary } from '../../types'

interface LoadIndicatorProps {
  summary: WeekSummary
}

export default function LoadIndicator({ summary }: LoadIndicatorProps) {
  const maxMinutes = 500
  const pct = Math.min((summary.completedMinutes / maxMinutes) * 100, 100)

  const getLoadLabel = () => {
    if (pct < 30) return { label: 'Baja', color: 'text-teal-400' }
    if (pct < 60) return { label: 'Moderada', color: 'text-yellow-400' }
    if (pct < 85) return { label: 'Alta', color: 'text-orange-400' }
    return { label: 'Máxima', color: 'text-red-400' }
  }

  const { label, color } = getLoadLabel()

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <span className="text-xs text-ink-muted font-medium">Carga semanal</span>
        <span className={`text-xs font-semibold ${color}`}>{label}</span>
      </div>
      <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-brand transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-ink-faint">
        <span>{summary.completedSessions} completadas</span>
        <span>{Math.round(summary.completedMinutes / 60)}h {summary.completedMinutes % 60}min</span>
      </div>
    </div>
  )
}
