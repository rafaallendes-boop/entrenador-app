import { lazy, Suspense, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrainingStore } from '../store/useTrainingStore'
import { todayISO, formatFullDate, currentWeekStartISO } from '../utils/date'
import { ROUTES } from '../constants/routes'
import WeekStrip from '../components/week/WeekStrip'
import LoadIndicator from '../components/dashboard/LoadIndicator'
import Card from '../components/ui/Card'
import { getDayNutrition } from '../services/nutritionEngine'

const CoachMessageCard = lazy(() => import('../components/dashboard/CoachMessageCard'))
const NextSessionCard = lazy(() => import('../components/dashboard/NextSessionCard'))
const NutritionFocusCard = lazy(() => import('../components/dashboard/NutritionFocusCard'))
const DailyCheckInCard = lazy(() => import('../components/dashboard/DailyCheckInCard'))
const InstallAppCard = lazy(() => import('../components/pwa/InstallAppCard'))

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

      <Suspense fallback={<CardSkeleton className="h-28" />}>
        <CoachMessageCard message={coachNote} />
      </Suspense>

      <Suspense fallback={<CardSkeleton className="h-32" />}>
        <DailyCheckInCard todaySessions={todaySessions} />
      </Suspense>

      <Suspense fallback={null}>
        <InstallAppCard />
      </Suspense>

      <div className="bg-surface-card rounded-card border border-surface-border">
        <WeekStrip showNav={false} onDayPress={(iso) => navigate(ROUTES.DAY(iso))} />
      </div>

      <Suspense fallback={<CardSkeleton className="h-32" />}>
        <NutritionFocusCard rec={todayNutrition} />
      </Suspense>

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

      {upcomingSessions.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
            Proximas sesiones
          </h2>
          <div className="space-y-2">
            <Suspense fallback={<CardSkeleton className="h-24" />}>
              {upcomingSessions.map(session => (
                <NextSessionCard key={session.id} session={session} />
              ))}
            </Suspense>
          </div>
        </div>
      )}
    </div>
  )
}

function CardSkeleton({ className }: { className: string }) {
  return <div className={`rounded-card border border-surface-border bg-surface-card animate-pulse ${className}`} />
}
