import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Target } from 'lucide-react'
import { useTrainingStore } from '../store/useTrainingStore'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { useUIStore } from '../store/useUIStore'
import { todayISO, formatFullDate } from '../utils/date'
import { ROUTES } from '../constants/routes'
import WeekStrip from '../components/week/WeekStrip'
import LoadIndicator from '../components/dashboard/LoadIndicator'
import LoadAnalyticsCard from '../components/dashboard/LoadAnalyticsCard'
import Card from '../components/ui/Card'
import { getDayNutrition } from '../services/nutritionEngine'
import { computeLoadAnalytics, type LoadAnalytics } from '../services/loadAnalytics'
import { startNotificationSync } from '../services/notifications'
import { getAthleteFirstName, getProfileCompleteness } from '../utils/athlete'
import { computeMacroPlan, getPrimaryGoalEvent } from '../services/macroPlan'

const CoachMessageCard = lazy(() => import('../components/dashboard/CoachMessageCard'))
const NextSessionCard = lazy(() => import('../components/dashboard/NextSessionCard'))
const NutritionFocusCard = lazy(() => import('../components/dashboard/NutritionFocusCard'))
const DailyCheckInCard = lazy(() => import('../components/dashboard/DailyCheckInCard'))
const InstallAppCard = lazy(() => import('../components/pwa/InstallAppCard'))
const MacroPlanCard = lazy(() => import('../components/dashboard/MacroPlanCard'))

export default function Dashboard() {
  const { sessions, currentWeekSummary, isLoading, loadWeek } = useTrainingStore()
  const { athleteProfile, loadMemory, saveAthleteProfile } = useCoachMemoryStore()
  const { currentWeekStart } = useUIStore()
  const navigate = useNavigate()
  const today = todayISO()
  const athleteFirstName = getAthleteFirstName(athleteProfile, 'atleta')

  const [loadAnalytics, setLoadAnalytics] = useState<LoadAnalytics | null>(null)
  const [isDeletingMacroPlan, setIsDeletingMacroPlan] = useState(false)

  // Macro plan — computed on-the-fly from profile, not persisted as source of truth
  const macroPlan = useMemo(() => computeMacroPlan(athleteProfile), [athleteProfile])
  const primaryGoalEvent = useMemo(() => getPrimaryGoalEvent(athleteProfile), [athleteProfile])

  useEffect(() => {
    void loadMemory()
  }, [loadMemory])

  useEffect(() => {
    loadWeek(currentWeekStart)
  }, [loadWeek, currentWeekStart])

  useEffect(() => {
    return startNotificationSync(() => sessions)
  }, [sessions])

  // Reload analytics whenever the viewed week changes (covers new completions too)
  useEffect(() => {
    void computeLoadAnalytics(4).then(setLoadAnalytics)
  }, [currentWeekStart, sessions])

  const todaySessions = sessions.filter(s => s.date === today)
  const completedToday = todaySessions.filter(s => s.status === 'completed').length

  const upcomingSessions = sessions
    .filter(s => s.status === 'planned' && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
    .slice(0, 4)

  const todayNutrition = getDayNutrition(todaySessions, athleteProfile)

  const coachNote = currentWeekSummary?.coachNote ??
    `Bienvenido${athleteProfile?.name ? `, ${athleteFirstName}` : ''}. Carga tu primera semana de entrenamiento y empieza a registrar tu progreso.`

  const profileCompleteness = getProfileCompleteness(athleteProfile ?? null)
  const showProfileNudge = profileCompleteness.state === 'partial' || profileCompleteness.state === 'missing_sports'

  async function handleDeleteMacroPlan() {
    if (isDeletingMacroPlan || !macroPlan) return

    const confirmed = window.confirm(
      'Esto eliminara el plan de competencia guardado y su evento principal. Puedes volver a crearlo despues.',
    )
    if (!confirmed) return

    setIsDeletingMacroPlan(true)
    try {
      await saveAthleteProfile({
        goalEvents: [],
        planWizardConfig: undefined,
        macroPlan: undefined,
      })
    } finally {
      setIsDeletingMacroPlan(false)
    }
  }

  return (
    <div className="px-4 pt-12 pb-6 space-y-5 md:px-6 md:space-y-6">
      <div>
        <p className="text-xs text-ink-muted font-medium uppercase tracking-wider">
          {formatFullDate(new Date())}
        </p>
        <h1 className="text-2xl font-bold text-ink mt-1">Hola, {athleteFirstName}</h1>
        {todaySessions.length > 0 && (
          <p className="text-sm text-ink-muted mt-1">
            <span className="text-emerald-400 font-semibold">{completedToday}</span>
            /{todaySessions.filter(s => s.status !== 'skipped').length} sesiones completadas hoy
          </p>
        )}
      </div>

      {showProfileNudge && (
        <button
          type="button"
          onClick={() => navigate(ROUTES.SETTINGS)}
          className="w-full text-left"
        >
          <Card className="p-4 border-brand/20 bg-brand/5 hover:bg-brand/10 transition-colors">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-base leading-none">💡</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  Completa tu perfil para mejorar el coach
                </p>
                <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                  {profileCompleteness.state === 'missing_sports'
                    ? 'Configura tu deporte principal para que el coach pueda personalizar tus entrenamientos.'
                    : `Falta: ${profileCompleteness.missing.join(', ')}. Con esos datos el coach propone cargas reales.`}
                </p>
                <p className="mt-2 text-xs font-medium text-brand-light">Ir a Ajustes →</p>
              </div>
            </div>
          </Card>
        </button>
      )}

      <Suspense fallback={<CardSkeleton className="h-28" />}>
        <CoachMessageCard message={coachNote} />
      </Suspense>

      {macroPlan ? (
        <Suspense fallback={<CardSkeleton className="h-32" />}>
          <MacroPlanCard
            macroPlan={macroPlan}
            eventTitle={primaryGoalEvent?.title}
            isDeleting={isDeletingMacroPlan}
            onDelete={() => { void handleDeleteMacroPlan() }}
          />
        </Suspense>
      ) : (
        <button
          type="button"
          onClick={() => navigate(ROUTES.COMPETITION_PLAN)}
          className="w-full text-left"
        >
          <Card className="p-4 border-surface-border hover:border-brand/30 hover:bg-brand/5 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-surface-raised flex items-center justify-center flex-shrink-0">
                <Target size={16} className="text-ink-faint" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">Crea tu plan de competencia</p>
                <p className="text-xs text-ink-muted mt-0.5">
                  Define tu evento y genera un plan por fases hasta el día de la carrera o el torneo.
                </p>
              </div>
              <span className="text-xs font-medium text-brand-light flex-shrink-0">Empezar →</span>
            </div>
          </Card>
        </button>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] xl:items-start">
        <div className="space-y-5 md:space-y-6">
          <Suspense fallback={<CardSkeleton className="h-32" />}>
            <DailyCheckInCard todaySessions={todaySessions} />
          </Suspense>

          <div className="bg-surface-card rounded-card border border-surface-border">
            <WeekStrip showNav onDayPress={(iso) => navigate(ROUTES.DAY(iso))} />
          </div>

          {upcomingSessions.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
                Proximas sesiones
              </h2>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1">
                <Suspense fallback={<CardSkeleton className="h-24" />}>
                  {upcomingSessions.map(session => (
                    <NextSessionCard key={session.id} session={session} />
                  ))}
                </Suspense>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-5 md:space-y-6">
          <Suspense fallback={null}>
            <InstallAppCard />
          </Suspense>

          <Suspense fallback={<CardSkeleton className="h-32" />}>
            <NutritionFocusCard rec={todayNutrition} />
          </Suspense>

          {/* Load analytics card — multi-week carga por disciplina */}
          {loadAnalytics && loadAnalytics.weeks.some(w => w.disciplines.length > 0) && (
            <Card className="p-4">
              <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
                Carga por disciplina
              </h2>
              <LoadAnalyticsCard analytics={loadAnalytics} />
            </Card>
          )}

          {currentWeekSummary && (
            <Card className="p-4">
              <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
                Semana actual
              </h2>
              <LoadIndicator summary={currentWeekSummary} />

              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-ink-muted flex-wrap">
                <span>
                  {currentWeekSummary.completedSessions}/{currentWeekSummary.plannedSessions} planificadas realizadas
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
        </div>
      </div>

      {isLoading && (
        <div className="px-1 py-2 text-center text-sm text-ink-muted">Cargando...</div>
      )}
    </div>
  )
}

function CardSkeleton({ className }: { className: string }) {
  return <div className={`rounded-card border border-surface-border bg-surface-card animate-pulse ${className}`} />
}
