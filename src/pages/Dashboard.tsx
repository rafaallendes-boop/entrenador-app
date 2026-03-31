import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrainingStore } from '../store/useTrainingStore'
import { todayISO, formatFullDate, currentWeekStartISO } from '../utils/date'
import { ROUTES } from '../constants/routes'
import WeekStrip from '../components/week/WeekStrip'
import CoachMessageCard from '../components/dashboard/CoachMessageCard'
import NextSessionCard from '../components/dashboard/NextSessionCard'
import LoadIndicator from '../components/dashboard/LoadIndicator'
import NutritionFocusCard from '../components/dashboard/NutritionFocusCard'
import DailyCheckInCard from '../components/dashboard/DailyCheckInCard'
import InstallAppCard from '../components/pwa/InstallAppCard'
import Card from '../components/ui/Card'
import { getDayNutrition } from '../services/nutritionEngine'

export default function Dashboard() {
  const { sessions, currentWeekSummary, loadWeek } = useTrainingStore()
  const navigate = useNavigate()
  const today = todayISO()

  useEffect(() => {
    loadWeek(currentWeekStartISO())
  }, [loadWeek])

  const todaySessions = sessions.filter(s => s.date === today)
  const completedToday = todaySessions.filter(s => s.status === 'completed').length

  const upcomingSessions = sessions
    .filter(s => s.status === 'planned' && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
    .slice(0, 4)

  const todayNutrition = getDayNutrition(todaySessions)

  const coachNote = currentWeekSummary?.coachNote ??
    'Bienvenido. Carga tu primera semana de entrenamiento y empieza a registrar tu progreso.'

  return (
    <div className="px-4 pt-12 pb-4 space-y-5">
      {/* Header */}
      <div>
        <p className="text-xs text-ink-muted font-medium uppercase tracking-wider">
          {formatFullDate(new Date())}
        </p>
        <h1 className="text-2xl font-bold text-ink mt-1">Hola, Rafael</h1>
        {todaySessions.length > 0 && (
          <p className="text-sm text-ink-muted mt-1">
            <span className="text-emerald-400 font-semibold">{completedToday}</span>
            /{todaySessions.filter(s => s.status !== 'skipped').length} sesiones completadas hoy
          </p>
        )}
      </div>

      {/* Coach message */}
      <CoachMessageCard message={coachNote} />

      {/* Daily check-in — only show if there are sessions today or it's today */}
      <DailyCheckInCard todaySessions={todaySessions} />

      <InstallAppCard />

      {/* Week strip */}
      <div className="bg-surface-card rounded-card border border-surface-border">
        <WeekStrip showNav={false} onDayPress={(iso) => navigate(ROUTES.DAY(iso))} />
      </div>

      {/* Nutrition focus for today */}
      <NutritionFocusCard rec={todayNutrition} />

      {/* Weekly load + objectives */}
      {currentWeekSummary && (
        <Card className="p-4">
          <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
            Semana actual
          </h2>
          <LoadIndicator summary={currentWeekSummary} />

          <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
            <span>
              {currentWeekSummary.completedSessions}/{currentWeekSummary.plannedSessions} sesiones realizadas
            </span>
            {currentWeekSummary.adherencePct != null && (
              <span className="text-brand-light font-semibold">
                {currentWeekSummary.adherencePct}% adherencia
              </span>
            )}
          </div>

          {currentWeekSummary.objectives && currentWeekSummary.objectives.length > 0 && (
            <div className="mt-4 pt-3 border-t border-surface-border">
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                Objetivos
              </p>
              <ul className="space-y-1.5">
                {currentWeekSummary.objectives.map((obj, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand mt-2 flex-shrink-0" />
                    {obj}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Upcoming sessions */}
      {upcomingSessions.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
            Próximas sesiones
          </h2>
          <div className="space-y-2">
            {upcomingSessions.map(session => (
              <NextSessionCard key={session.id} session={session} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
