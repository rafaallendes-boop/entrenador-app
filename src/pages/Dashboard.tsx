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

  const todayNutrition = getDayNutrition(todaySessions, athleteProfile, dayLogs[today])

  const hasTrainingHistory = allWeekSummaries.length > 0 || sessions.length > 0 || currentWeekSummary != null
  const defaultCoachNote = hasTrainingHistory
    ? `Hola ${athleteFirstName}, ¿cómo viene la semana? Revisa tu semana en curso o solicita a RallyIQ que actualice tu plan.`
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
      <section className="panel-grid relative overflow-hidden rounded-[1.75rem] border border-surface-soft/40 bg-[linear-gradient(150deg,rgba(24,18,14,0.99),rgba(10,8,8,1))] px-5 py-6 shadow-hud">
        {/* Top orange accent line */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/50 to-transparent" />

        {/* Ambient orange glow — left */}
        <div className="pointer-events-none absolute -left-10 -top-10 h-52 w-52 rounded-full bg-brand/10 blur-[56px]" />

        {/* Ambient ember — bottom right */}
        <div className="pointer-events-none absolute -bottom-8 right-12 h-36 w-36 rounded-full bg-brand/6 blur-[48px]" />

        {/* Watermark bolt */}
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 select-none opacity-[0.038]">
          <svg viewBox="0 0 32 32" className="h-44 w-44" fill="#ff4d00" aria-hidden>
            <path d="M20 3L8 19H16L13 29L25 13H17L20 3Z" />
          </svg>
        </div>

        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          {/* Left: greeting */}
          <div className="min-w-0">
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.42em] text-ink-faint">
              {formatFullDate(new Date())}
            </p>
            <h1 className="mt-2 font-display text-[2.2rem] font-bold leading-none tracking-tight text-ink md:text-5xl">
              Hola,{' '}
              <span
                style={{
                  background: 'linear-gradient(90deg, #ff4d00 0%, #ff7a33 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {athleteFirstName}
              </span>
            </h1>
            <p className="mt-2.5 max-w-xs text-[13px] leading-relaxed text-ink-faint">
              Tu centro de control · carga, RallyIQ y decisiones en tiempo real.
            </p>
          </div>

          {/* Right: stat instruments */}
          <div className="grid grid-cols-2 gap-2.5 sm:min-w-[230px]">
            {/* Stat: sessions today */}
            <div
              className="relative overflow-hidden rounded-2xl px-3.5 py-3"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {/* Top accent stripe */}
              <div
                className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl"
                style={{
                  background: todaySessions.length > 0
                    ? 'linear-gradient(90deg, #ff4d00, #ff7a33)'
                    : 'rgba(255,255,255,0.08)',
                }}
              />
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.32em] text-ink-faint">Hoy</p>
              <p className="mt-1.5 font-mono text-3xl font-bold leading-none text-ink">
                {todaySessions.length}
              </p>
              <p className="mt-1 text-[10.5px] text-ink-faint">sesiones</p>
            </div>

            {/* Stat: completed */}
            <div
              className="relative overflow-hidden rounded-2xl px-3.5 py-3"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {/* Top accent stripe */}
              <div
                className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl"
                style={{
                  background: completedToday > 0
                    ? 'linear-gradient(90deg, #ff4d00, #ff7a33)'
                    : 'rgba(255,255,255,0.08)',
                }}
              />
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.32em] text-ink-faint">Hechas</p>
              <p className="mt-1.5 font-mono text-3xl font-bold leading-none text-ink">
                {completedToday}
                <span className="text-base font-normal text-ink-faint">
                  /{todaySessions.filter(s => s.status !== 'skipped').length || 0}
                </span>
              </p>
              <p className="mt-1 text-[10.5px] text-ink-faint">completadas</p>
            </div>
          </div>
        </div>
      </section>

      {showProfileNudge && (
        <button
          type="button"
          onClick={() => navigate(ROUTES.SETTINGS)}
          className="w-full text-left"
        >
          <Card variant="hud" accent="ember" className="border-forge-ember/20 bg-[linear-gradient(145deg,rgba(255,235,156,0.12),rgba(14,14,14,0.96))] p-4 transition-colors hover:bg-[linear-gradient(145deg,rgba(255,235,156,0.16),rgba(14,14,14,0.98))]">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-base leading-none text-forge-ember">▲</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  Completa tu perfil para mejorar RallyIQ
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  {profileCompleteness.state === 'missing_sports'
                    ? 'Configura tu deporte principal para que RallyIQ pueda personalizar tus entrenamientos.'
                    : `Falta: ${profileCompleteness.missing.join(', ')}. Con esos datos RallyIQ propone cargas reales.`}
                </p>
                <p className="mt-2 text-xs font-medium text-forge-ember">Ir a Ajustes →</p>
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
          <Card
            variant="hud"
            accent="ember"
            className="border-surface-border p-4 transition-colors hover:border-brand/30 hover:bg-brand/5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-brand/15 bg-brand/10">
                <Target size={16} className="text-brand-light" />
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

          <div className="rounded-card border border-surface-soft/70 bg-surface-panel shadow-panel">
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
            <Card variant="hud" accent="cyan" className="p-4">
              <h2 className="font-display mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-ink-muted">
                Carga por disciplina
              </h2>
              <LoadAnalyticsCard analytics={loadAnalytics} />
            </Card>
          )}

          {currentWeekSummary && (
            <Card variant="hud" accent="ember" className="p-4">
              <h2 className="font-display mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-ink-muted">
                Semana actual
              </h2>
              <LoadIndicator summary={currentWeekSummary} />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted">
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
                          <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand" />
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
