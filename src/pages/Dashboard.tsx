import { ChevronDown, Target } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTrainingStore } from '../store/useTrainingStore'
import { useCoachActionsStore } from '../store/useCoachActionsStore'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { useUIStore } from '../store/useUIStore'
import { todayISO, formatFullDate } from '../utils/date'
import { ROUTES } from '../constants/routes'
import WeekStrip from '../components/week/WeekStrip'
import LoadIndicator from '../components/dashboard/LoadIndicator'
import LoadAnalyticsCard from '../components/dashboard/LoadAnalyticsCard'
import Card from '../components/ui/Card'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { getDayNutrition } from '../services/nutritionEngine'
import { startNotificationSync } from '../services/notifications'
import { getAthleteFirstName, getProfileCompleteness } from '../utils/athlete'
import { computeMacroPlan, getPrimaryGoalEvent } from '../services/macroPlan'
import { useMacroWeekCoherence } from '../hooks/useMacroWeekCoherence'
import { useWeeklyActionNavigator } from '../hooks/useWeeklyActionNavigator'
import { useWeeklySnapshot } from '../hooks/useWeeklySnapshot'
import type { CoachProposal } from '../types'

const CoachMessageCard = lazy(() => import('../components/dashboard/CoachMessageCard'))
const NextSessionCard = lazy(() => import('../components/dashboard/NextSessionCard'))
const NutritionFocusCard = lazy(() => import('../components/dashboard/NutritionFocusCard'))
const DailyCheckInCard = lazy(() => import('../components/dashboard/DailyCheckInCard'))
const InstallAppCard = lazy(() => import('../components/pwa/InstallAppCard'))
const MacroPlanCard = lazy(() => import('../components/dashboard/MacroPlanCard'))
const ActionAlertsCard = lazy(() => import('../components/dashboard/ActionAlertsCard'))
const ProposalDrawer = lazy(() => import('../components/chat/ProposalDrawer'))

export default function Dashboard() {
  const { sessions, dayLogs, currentWeekSummary, isLoading, loadWeek, allWeekSummaries } = useTrainingStore()
  const { addProposal, acceptProposal, rejectProposal } = useCoachActionsStore()
  const { athleteProfile, loadMemory, saveAthleteProfile } = useCoachMemoryStore()
  const { currentWeekStart } = useUIStore()
  const location = useLocation()
  const navigate = useNavigate()
  const today = todayISO()
  const athleteFirstName = getAthleteFirstName(athleteProfile, 'atleta')

  const [isDeletingMacroPlan, setIsDeletingMacroPlan] = useState(false)
  const [objectivesExpanded, setObjectivesExpanded] = useState(false)
  const [checkInExpandToken, setCheckInExpandToken] = useState(0)
  const [showDeleteMacroPlanConfirm, setShowDeleteMacroPlanConfirm] = useState(false)
  const [activeProposal, setActiveProposal] = useState<CoachProposal | null>(null)
  const [proposalError, setProposalError] = useState<string | null>(null)

  // Macro plan — computed on-the-fly from profile, not persisted as source of truth
  const macroPlan = useMemo(() => computeMacroPlan(athleteProfile), [athleteProfile])
  const primaryGoalEvent = useMemo(() => getPrimaryGoalEvent(athleteProfile), [athleteProfile])
  const macroWeekCoherence = useMacroWeekCoherence()
  const handleSelectAction = useWeeklyActionNavigator({
    weeklyRule: macroWeekCoherence.weeklyRule,
    onCheckIn: () => {
      setCheckInExpandToken((value) => value + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
  })

  useEffect(() => {
    void loadMemory()
  }, [loadMemory])

  useEffect(() => {
    loadWeek(currentWeekStart)
  }, [loadWeek, currentWeekStart])

  const {
    loadAnalytics,
    weeklyActionSummary,
    autoAdjustmentDraft,
  } = useWeeklySnapshot(currentWeekStart, {
    sessions,
    currentWeekSummary,
    todayDayLog: dayLogs[today],
    macroWeekCoherence,
    athleteProfile,
    today,
  })

  useEffect(() => {
    return startNotificationSync(() => ({
      sessions,
      currentWeekSummary,
      macroWeekCoherence,
      todayDayLog: dayLogs[today],
      athleteProfile,
      loadAnalytics,
      weeklyActionSummary,
      autoAdjustmentDraft,
    }))
  }, [sessions, currentWeekSummary, macroWeekCoherence, dayLogs, today, athleteProfile, loadAnalytics, weeklyActionSummary, autoAdjustmentDraft])

  const todaySessions = sessions.filter(s => s.date === today)
  const completedToday = todaySessions.filter(s => s.status === 'completed').length

  const upcomingSessions = sessions
    .filter(s => s.status === 'planned' && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
    .slice(0, 4)

  const todayNutrition = getDayNutrition(todaySessions, athleteProfile)

  const hasTrainingHistory = allWeekSummaries.length > 0
  const defaultCoachNote = hasTrainingHistory
    ? `Hola ${athleteFirstName}, ¿cómo viene la semana? Revisa tu semana en curso o solicita al coach que actualice tu plan.`
    : `Bienvenido${athleteProfile?.name ? `, ${athleteFirstName}` : ''}. Carga tu primera semana de entrenamiento y empieza a registrar tu progreso.`
  const coachNote = currentWeekSummary?.coachNote ?? defaultCoachNote

  const profileCompleteness = getProfileCompleteness(athleteProfile ?? null)
  const showProfileNudge = (
    Boolean((location.state as { showProfileNudge?: boolean } | null)?.showProfileNudge)
    || profileCompleteness.state === 'partial'
    || profileCompleteness.state === 'missing_sports'
  )

  useEffect(() => {
    if (!(location.state && typeof location.state === 'object' && 'showProfileNudge' in location.state)) return
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  async function handleOpenAutoAdjustment() {
    if (!autoAdjustmentDraft) return
    setProposalError(null)
    const proposal = await addProposal(
      autoAdjustmentDraft.message,
      autoAdjustmentDraft.actions,
      undefined,
      { source: 'dashboard_auto_adjustment', relatedAlertId: autoAdjustmentDraft.alertId },
    )
    setActiveProposal(proposal)
  }

  async function handleAcceptAutoAdjustment() {
    if (!activeProposal) return
    const result = await acceptProposal(activeProposal.id)
    if (result.errors.length > 0) {
      setProposalError(result.errors.join(' '))
      return
    }
    setProposalError(null)
    setActiveProposal(null)
  }

  function handleCloseAutoAdjustment() {
    if (activeProposal && activeProposal.status === 'pending') {
      void rejectProposal(activeProposal.id)
    }
    setProposalError(null)
    setActiveProposal(null)
  }

  async function handleDeleteMacroPlan() {
    if (isDeletingMacroPlan || !macroPlan) return

    setIsDeletingMacroPlan(true)
    try {
      await saveAthleteProfile({
        goalEvents: [],
        planWizardConfig: undefined,
        macroPlan: undefined,
      })
    } finally {
      setIsDeletingMacroPlan(false)
      setShowDeleteMacroPlanConfirm(false)
    }
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-12 md:px-6 md:space-y-6">
      <div>
        <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
          {formatFullDate(new Date())}
        </p>
        <h1 className="font-display mt-0.5 text-3xl font-bold tracking-tight text-ink md:text-4xl">
          Hola, {athleteFirstName}
        </h1>
        {todaySessions.length > 0 && (
          <p className="mt-1.5 flex items-center gap-2 text-sm text-ink-muted">
            <span className="font-mono tabular-nums">
              <span className="font-semibold text-emerald-400">{completedToday}</span>
              <span className="text-ink-faint">/{todaySessions.filter(s => s.status !== 'skipped').length}</span>
            </span>
            <span>sesiones hoy</span>
          </p>
        )}
      </div>

      {showProfileNudge && (
        <button
          type="button"
          onClick={() => navigate(ROUTES.SETTINGS)}
          className="w-full text-left"
        >
          <Card className="border-brand/20 bg-brand/5 p-4 transition-colors hover:bg-brand/10">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-base leading-none">💡</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  Completa tu perfil para mejorar el coach
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
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

      {proposalError && (
        <Card className="border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
          {proposalError}
        </Card>
      )}

      <Suspense fallback={<CardSkeleton className="h-36" />}>
        <ActionAlertsCard
          summary={weeklyActionSummary}
          onSelectAction={handleSelectAction}
          onOpenAutoAdjustment={autoAdjustmentDraft ? () => { void handleOpenAutoAdjustment() } : undefined}
        />
      </Suspense>

      {macroPlan ? (
        <Suspense fallback={<CardSkeleton className="h-32" />}>
            <MacroPlanCard
              macroPlan={macroPlan}
              eventTitle={primaryGoalEvent?.title}
              isDeleting={isDeletingMacroPlan}
              onDelete={() => setShowDeleteMacroPlanConfirm(true)}
            />
          </Suspense>
      ) : (
        <button
          type="button"
          onClick={() => navigate(ROUTES.COMPETITION_PLAN)}
          className="w-full text-left"
        >
          <Card className="border-surface-border p-4 transition-colors hover:border-brand/30 hover:bg-brand/5">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-raised">
                <Target size={16} className="text-ink-faint" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">Crea tu plan de competencia</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Define tu evento y genera un plan por fases hasta el día de la carrera o el torneo.
                </p>
              </div>
              <span className="flex-shrink-0 text-xs font-medium text-brand-light">Empezar →</span>
            </div>
          </Card>
        </button>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] xl:items-start">
        <div className="space-y-5 md:space-y-6">
          <Suspense fallback={<CardSkeleton className="h-32" />}>
            <DailyCheckInCard todaySessions={todaySessions} autoExpandToken={checkInExpandToken} />
          </Suspense>

          <div className="bg-surface-card rounded-card border border-surface-border">
            <WeekStrip showNav onDayPress={(iso) => navigate(ROUTES.DAY(iso))} />
          </div>

          {upcomingSessions.length > 0 && (
            <div>
              <h2 className="font-display mb-3 text-sm font-semibold uppercase tracking-wider text-ink-muted">
                Próximas sesiones
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
              <h2 className="font-display mb-3 text-sm font-semibold uppercase tracking-wider text-ink-muted">
                Carga por disciplina
              </h2>
              <LoadAnalyticsCard analytics={loadAnalytics} />
            </Card>
          )}

          {currentWeekSummary && (
            <Card className="p-4">
              <h2 className="font-display mb-3 text-sm font-semibold uppercase tracking-wider text-ink-muted">
                Semana actual
              </h2>
              <LoadIndicator summary={currentWeekSummary} />

              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-ink-muted flex-wrap">
                <span className="font-mono tabular-nums">
                  <span className="font-semibold text-ink">{currentWeekSummary.completedSessions}</span>
                  <span className="text-ink-faint">/{currentWeekSummary.plannedSessions}</span>
                  <span className="ml-1.5">planificadas</span>
                </span>
                {currentWeekSummary.adherencePct != null && (
                  <span className="font-mono tabular-nums font-semibold text-brand-light">
                    {currentWeekSummary.adherencePct}%
                  </span>
                )}
              </div>

              {currentWeekSummary.objectives && currentWeekSummary.objectives.length > 0 && (
                <div className="mt-4 pt-3 border-t border-surface-border">
                  <button
                    type="button"
                    onClick={() => setObjectivesExpanded(v => !v)}
                    className="flex items-center justify-between w-full text-left gap-2"
                  >
                    <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                      Objetivos por deporte
                      <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-faint">
                        ({currentWeekSummary.objectives.length})
                      </span>
                    </p>
                    <ChevronDown
                      size={14}
                      className={`text-ink-faint transition-transform flex-shrink-0 ${objectivesExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {objectivesExpanded && (
                    <ul className="mt-2 space-y-1.5">
                      {currentWeekSummary.objectives.map((obj, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-ink">
                          <span className="w-1.5 h-1.5 rounded-full bg-brand mt-2 flex-shrink-0" />
                          {obj}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="px-1 py-2 text-center text-sm text-ink-muted">Cargando...</div>
      )}

      <ConfirmDialog
        open={showDeleteMacroPlanConfirm}
        title="Eliminar plan de competencia"
        message="Esto eliminara el plan de competencia guardado y su evento principal. Puedes volver a crearlo despues."
        confirmLabel="Eliminar plan"
        destructive
        isLoading={isDeletingMacroPlan}
        onCancel={() => setShowDeleteMacroPlanConfirm(false)}
        onConfirm={() => { void handleDeleteMacroPlan() }}
      />

      {activeProposal && (
        <Suspense fallback={null}>
          <ProposalDrawer
            proposal={activeProposal}
            existingSessions={sessions}
            onAccept={() => { void handleAcceptAutoAdjustment() }}
            onReject={handleCloseAutoAdjustment}
            onClose={handleCloseAutoAdjustment}
          />
        </Suspense>
      )}
    </div>
  )
}

function CardSkeleton({ className }: { className: string }) {
  return <div className={`rounded-card border border-surface-border bg-surface-card animate-pulse ${className}`} />
}
