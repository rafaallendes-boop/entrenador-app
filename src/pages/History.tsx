import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingDown, TrendingUp, Weight, Zap, Wind, Dumbbell } from 'lucide-react'
import { useTrainingStore } from '../store/useTrainingStore'
import { useUIStore } from '../store/useUIStore'
import { formatWeekRange, fromISO } from '../utils/date'
import WeekSummaryCard from '../components/week/WeekSummaryCard'
import { ROUTES } from '../constants/routes'

export default function History() {
  const { allWeekSummaries, loadAllSummaries } = useTrainingStore()
  const { setCurrentWeekStart, setSelectedDate } = useUIStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadAllSummaries()
  }, [loadAllSummaries])

  return (
    <div className="px-4 pt-12 pb-8">
      <h1 className="text-xl font-bold text-ink mb-1">Historial</h1>
      <p className="text-sm text-ink-muted mb-5">Tus semanas de entrenamiento</p>

      {allWeekSummaries.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-ink-faint text-sm">Sin historial aún</p>
        </div>
      ) : (
        <div className="space-y-4">
          {allWeekSummaries.map((summary, index) => (
            <div key={summary.id}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold text-ink capitalize">
                    {formatWeekRange(fromISO(summary.weekStartDate))}
                  </p>
                  <div className="flex gap-3 mt-1">
                    <span className="flex items-center gap-1 text-xs text-yellow-400">
                      <Zap size={11} /> {summary.squashSessions}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-sky-400">
                      <Wind size={11} /> {summary.runningSessions}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-orange-400">
                      <Dumbbell size={11} /> {summary.strengthSessions}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setCurrentWeekStart(summary.weekStartDate)
                    setSelectedDate(summary.weekStartDate)
                    navigate(ROUTES.WEEK)
                  }}
                  className="text-xs text-brand-light font-medium px-3 py-1.5 rounded-lg bg-brand/10 hover:bg-brand/20 transition-colors"
                >
                  Ver semana
                </button>
              </div>

              <WeekSummaryCard summary={summary} showDisciplineAdherence />

              {summary.avgBodyWeight != null && (
                <div className="mt-2 px-1 flex items-center gap-2 flex-wrap text-xs">
                  <span className="inline-flex items-center gap-1 text-cyan-400">
                    <Weight size={12} />
                    {summary.avgBodyWeight.toFixed(1)} kg promedio
                  </span>
                  {renderWeightDelta(summary.avgBodyWeight, allWeekSummaries[index + 1]?.avgBodyWeight)}
                  {summary.weightEntries != null && summary.weightEntries > 0 && (
                    <span className="text-ink-faint">
                      {summary.weightEntries} registro{summary.weightEntries !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              )}

              {summary.weekNotes && (
                <p className="text-xs text-ink-muted mt-2 px-1 italic">
                  {summary.weekNotes}
                </p>
              )}

              {summary.objectives && summary.objectives.length > 0 && (
                <div className="mt-2 px-1">
                  <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-1">
                    Objetivos
                  </p>
                  <ul className="space-y-0.5">
                    {summary.objectives.map((obj, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-ink-muted">
                        <span className="w-1 h-1 rounded-full bg-ink-faint mt-1.5 flex-shrink-0" />
                        {obj}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function renderWeightDelta(current?: number, previous?: number) {
  if (current == null || previous == null) return null
  const delta = current - previous

  if (Math.abs(delta) < 0.05) {
    return <span className="text-ink-faint">sin cambio relevante</span>
  }

  const rising = delta > 0
  const Icon = rising ? TrendingUp : TrendingDown
  const colorClass = rising ? 'text-amber-400' : 'text-emerald-400'

  return (
    <span className={`inline-flex items-center gap-1 ${colorClass}`}>
      <Icon size={12} />
      {`${rising ? '+' : ''}${delta.toFixed(1)} kg vs semana previa`}
    </span>
  )
}
