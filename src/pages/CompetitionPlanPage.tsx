import { useCallback, useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import PlanDashboard from './PlanDashboard'
import { ChevronLeft, ChevronRight, Target, Sparkles, SkipForward, Trash2 } from 'lucide-react'
import { ROUTES } from '../constants/routes'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { CycleHistory } from '../components/planBuilder/CycleHistory'
import { useEntitlement } from '../hooks/useEntitlement'
import { db } from '../db/db'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { useAuthStore } from '../store/useAuthStore'
import { usePlanBuilderStore } from '../store/usePlanBuilderStore'
import { useTrainingStore } from '../store/useTrainingStore'
import { computeMacroPlan, getPrimaryGoalEvent, getPhaseLabel } from '../services/macroPlan'
import { filterRowsToActiveScope } from '../services/athlete/activeScopeFilter'
import { getActiveAthleteId, getSwitchEpoch } from '../services/athlete/activeAthlete'
import { getCompetitionPlanWeekCount, MAX_COMPETITION_PLAN_WEEKS } from '../services/planBuilder/buildPlanShell'
import { closePlanCycle } from '../services/planBuilder/closePlanCycle'
import { deletePlanCycle } from '../services/planBuilder/deletePlanCycle'
import { getPlanWizardDefaultComplementarySports } from '../services/planningConstraints'
import { getEnabledSports } from '../utils/athlete'
import { isStrictISODate } from '../utils/date'
import {
  formatGoalEventKeyDate,
  formatGoalEventWindow,
  validateGoalEventWindow,
} from '../services/goalEventWindow'
import {
  DAY_OF_WEEK_ORDER,
  MAX_WEEKLY_SESSIONS,
  clampSessionsPerWeekToAvailability,
  getSessionCapacityFromAvailability,
  mapOnboardingDaysToTrainingDays,
  orderSelectedValues,
  replaceOrderedValues,
  toggleOrderedValue,
} from '../utils/schedule'
import { v4 as uuid } from '../utils/uuid'
import {
  formatStrengthConstraintFeedback,
  resolveStrengthSafetyConstraints,
} from '../services/training/strengthSafetyConstraints'
import type {
  GoalEventType,
  GoalEventObjective,
  GoalEventLevel,
  MacroPlanPhase,
  DayOfWeek,
  WizardFitnessLevel,
  WizardFatigueLevel,
  SupportedSport,
} from '../types'

// ─── Step definitions ──────────────────────────────────────────────────────────

const TOTAL_STEPS = 7

type WizardMode = 'edit' | 'new_cycle' | null

function isStableAthleteOperation(athleteId: string, switchEpoch: number): boolean {
  return getActiveAthleteId() === athleteId && getSwitchEpoch() === switchEpoch
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const EVENT_TYPE_OPTIONS: { value: GoalEventType; label: string; emoji: string; sport: SupportedSport | null }[] = [
  { value: 'tournament', label: 'Torneo de squash', emoji: '🏆', sport: 'squash' },
  { value: 'race',       label: 'Carrera / Running', emoji: '🏃', sport: 'running' },
  { value: 'cycling_event', label: 'Evento de ciclismo', emoji: '🚴', sport: 'cycling' },
  { value: 'other',      label: 'Otro evento', emoji: '🎯', sport: null },
]

const OBJECTIVE_OPTIONS: { value: GoalEventObjective; label: string; sub: string }[] = [
  { value: 'win',           label: 'Ganar / Competir por el resultado', sub: 'El podio es el objetivo' },
  { value: 'perform',       label: 'Rendir al máximo', sub: 'El proceso importa más que el resultado' },
  { value: 'finish',        label: 'Terminar bien / Llegar', sub: 'La meta es completarlo' },
  { value: 'personal_best', label: 'Mejorar mi marca', sub: 'Superar mi mejor tiempo o rendimiento' },
]

const LEVEL_OPTIONS_BY_SPORT: Record<'squash' | 'running' | 'cycling' | 'other', { value: GoalEventLevel; label: string }[]> = {
  squash: [
    { value: 'recreational', label: 'Jugador Novicio (5ta-6ta)' },
    { value: 'competitive',  label: 'Jugador Intermedio (3ra-4ta)' },
    { value: 'masters',      label: 'Jugador Avanzado (1ra-2da)' },
    { value: 'elite',        label: 'Jugador Profesional' },
  ],
  running: [
    { value: 'recreational', label: 'Principiante' },
    { value: 'competitive',  label: 'Aficionado' },
    { value: 'masters',      label: 'Competitivo amateur' },
    { value: 'elite',        label: 'Elite / Sub-élite' },
  ],
  cycling: [
    { value: 'recreational', label: 'Novicio' },
    { value: 'competitive',  label: 'Principiante' },
    { value: 'masters',      label: 'Avanzado' },
    { value: 'elite',        label: 'Elite' },
  ],
  other: [
    { value: 'recreational', label: 'Recreativo' },
    { value: 'competitive',  label: 'Competitivo amateur' },
    { value: 'masters',      label: 'Masters / Veterano' },
    { value: 'elite',        label: 'Elite amateur' },
  ],
}

function getLevelOptionsForSport(sport: SupportedSport | null): { value: GoalEventLevel; label: string }[] {
  if (sport === 'squash')  return LEVEL_OPTIONS_BY_SPORT.squash
  if (sport === 'running') return LEVEL_OPTIONS_BY_SPORT.running
  if (sport === 'cycling') return LEVEL_OPTIONS_BY_SPORT.cycling
  return LEVEL_OPTIONS_BY_SPORT.other
}

const DAYS_OF_WEEK: { value: DayOfWeek; label: string; short: string }[] = [
  { value: 'monday',    label: 'Lunes',    short: 'L' },
  { value: 'tuesday',   label: 'Martes',   short: 'Ma' },
  { value: 'wednesday', label: 'Miércoles', short: 'Mi' },
  { value: 'thursday',  label: 'Jueves',   short: 'J' },
  { value: 'friday',    label: 'Viernes',  short: 'V' },
  { value: 'saturday',  label: 'Sábado',   short: 'S' },
  { value: 'sunday',    label: 'Domingo',  short: 'D' },
]

const SESSION_DURATION_OPTIONS = [
  { value: 30,  label: '30 min' },
  { value: 45,  label: '45 min' },
  { value: 60,  label: '1 hora' },
  { value: 90,  label: '1:30 h' },
  { value: 120, label: '2 horas' },
]

const SESSIONS_PER_WEEK_OPTIONS = Array.from(
  { length: MAX_WEEKLY_SESSIONS - 1 },
  (_, index) => index + 2,
)

const FITNESS_OPTIONS: { value: WizardFitnessLevel; label: string; sub: string }[] = [
  { value: 'fit',       label: 'En buena forma', sub: 'Vengo entrenando bien' },
  { value: 'normal',    label: 'Normal, base sólida', sub: 'Sin picos, pero constante' },
  { value: 'returning', label: 'Volviendo de descanso o lesión', sub: 'Acabo de retomar' },
  { value: 'low',       label: 'Bajo de forma', sub: 'Llevo tiempo sin entrenar' },
]

const FATIGUE_OPTIONS: { value: WizardFatigueLevel; label: string }[] = [
  { value: 'fresh',     label: 'Descansado' },
  { value: 'normal',    label: 'Normal' },
  { value: 'loaded',    label: 'Cargado' },
  { value: 'overloaded', label: 'Muy cargado' },
]

const SPORT_LABELS: Record<SupportedSport, string> = {
  squash:   'Squash',
  running:  'Running',
  strength: 'Fuerza',
  mobility: 'Movilidad',
  cycling:  'Ciclismo',
}

const SPORT_EMOJI: Record<SupportedSport, string> = {
  squash:   '🎾',
  running:  '🏃',
  strength: '🏋️',
  mobility: '🧘',
  cycling:  '🚴',
}

// ─── Wizard state ─────────────────────────────────────────────────────────────

interface WizardState {
  eventType?: GoalEventType
  eventTitle: string
  eventDate: string
  /** Vacío = evento de un día. */
  eventEndDate: string
  eventKeyDate: string
  objective?: GoalEventObjective
  competitiveLevel?: GoalEventLevel
  trainingDays: DayOfWeek[]
  doubleSessionDays: DayOfWeek[]
  sessionsPerWeek?: number
  sessionDurationMins?: number
  allowDoubleSession: boolean
  complementarySports: SupportedSport[]
  fitnessLevel?: WizardFitnessLevel
  fatigue?: WizardFatigueLevel
  injuryNotes: string
}

function getSportForEventType(eventType: GoalEventType | undefined): SupportedSport | null {
  return EVENT_TYPE_OPTIONS.find((option) => option.value === eventType)?.sport ?? null
}

function initWizardState(
  athleteProfile: ReturnType<typeof useCoachMemoryStore.getState>['athleteProfile'],
  existingEvent: ReturnType<typeof getPrimaryGoalEvent>,
  existingConfig: import('../types').PlanWizardConfig | undefined,
): WizardState {
  const primarySportForEvent = getSportForEventType(existingEvent?.eventType)
  const defaultComplementary = getPlanWizardDefaultComplementarySports(existingConfig, primarySportForEvent)
  const trainingDays = orderSelectedValues(
    existingConfig?.trainingDays ?? mapOnboardingDaysToTrainingDays(athleteProfile?.scheduleProfile?.availableDays),
    DAY_OF_WEEK_ORDER,
  )
  const profileDoubleSessionDays = mapOnboardingDaysToTrainingDays(athleteProfile?.scheduleProfile?.doubleSessionDays)
  const doubleSessionDays = orderSelectedValues(
    (existingConfig?.doubleSessionDays ?? profileDoubleSessionDays).filter((day) => trainingDays.includes(day)),
    DAY_OF_WEEK_ORDER,
  )
  const allowDoubleSession = existingConfig?.allowDoubleSession ?? doubleSessionDays.length > 0

  return {
    eventType: existingEvent?.eventType,
    eventTitle: existingEvent?.title ?? '',
    eventDate: existingEvent?.date ?? '',
    eventEndDate: existingEvent?.endDate ?? '',
    eventKeyDate: existingEvent?.keyDate ?? '',
    objective: existingEvent?.objective,
    competitiveLevel: existingEvent?.competitiveLevel,
    trainingDays,
    doubleSessionDays,
    sessionsPerWeek: clampSessionsPerWeekToAvailability(
      existingConfig?.sessionsPerWeek
        ?? (trainingDays.length >= 2 ? Math.min(trainingDays.length, Math.max(...SESSIONS_PER_WEEK_OPTIONS)) : undefined),
      trainingDays,
      allowDoubleSession,
      doubleSessionDays,
    ),
    sessionDurationMins: existingConfig?.sessionDurationMins,
    allowDoubleSession,
    complementarySports: defaultComplementary,
    fitnessLevel: existingConfig?.currentFitnessLevel,
    fatigue: existingConfig?.currentFatigue,
    injuryNotes: existingConfig?.injuryNotes ?? '',
  }
}

function initWizardStateForNewCycle(
  athleteProfile: ReturnType<typeof useCoachMemoryStore.getState>['athleteProfile'],
  previousEvent: ReturnType<typeof getPrimaryGoalEvent>,
  previousConfig: import('../types').PlanWizardConfig | undefined,
): WizardState {
  const inherited = initWizardState(athleteProfile, previousEvent, previousConfig)
  return {
    ...inherited,
    eventTitle: '',
    eventDate: '',
    eventEndDate: '',
    eventKeyDate: '',
    objective: undefined,
    fitnessLevel: undefined,
    fatigue: undefined,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function weeksUntil(dateStr: string, now: Date = new Date()): number {
  if (!isStrictISODate(dateStr)) return 0
  const diff = new Date(`${dateStr}T00:00:00.000Z`).getTime() - now.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24 * 7))
}

function addDaysToISO(date: Date, days: number): string {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function phasesFromWeeks(weeks: number): string {
  if (weeks > 10) return 'Base → Build → Peak → Taper'
  if (weeks > 8)  return 'Build → Peak → Taper'
  if (weeks > 4)  return 'Peak → Taper'
  if (weeks > 1)  return 'Taper directo'
  return 'Semana de competencia'
}

function getPlanWindow(
  eventDate: string,
  trainingDays: readonly DayOfWeek[],
  now: Date = new Date(),
  eventEndDate?: string,
) {
  const totalWeeksUntilEvent = weeksUntil(eventDate, now)
  // El preview comparte la ventana exacta del shell: contar sólo hasta el
  // inicio subestimaría un campeonato que cruza dos semanas calendario.
  const uncappedPlanWeeks = totalWeeksUntilEvent > 0
    ? getCompetitionPlanWeekCount({ date: eventDate, endDate: eventEndDate }, trainingDays, now)
    : 0
  const effectivePlanWeeks = uncappedPlanWeeks > 0
    ? Math.min(MAX_COMPETITION_PLAN_WEEKS, uncappedPlanWeeks)
    : 0
  const maxSelectableDate = addDaysToISO(now, MAX_COMPETITION_PLAN_WEEKS * 7)

  return {
    totalWeeksUntilEvent,
    effectivePlanWeeks,
    exceedsMax: uncappedPlanWeeks > MAX_COMPETITION_PLAN_WEEKS,
    isFuture: totalWeeksUntilEvent > 0,
    isValidDate: isStrictISODate(eventDate),
    maxSelectableDate,
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  const pct = Math.round((step / TOTAL_STEPS) * 100)
  return (
    <div className="h-1 bg-surface-raised rounded-full overflow-hidden">
      <div
        className="h-full bg-brand transition-all duration-300 ease-out rounded-full"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function StepLabel({ step }: { step: number }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-brand-light">
      Paso {step} de {TOTAL_STEPS}
    </p>
  )
}

function Question({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xl font-bold text-ink leading-snug mt-2 mb-1">{children}</h2>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-ink-muted leading-relaxed mb-5">{children}</p>
  )
}

function chipCls(active: boolean) {
  return `rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer text-left ${
    active
      ? 'border-brand/50 bg-brand/15 text-brand-light'
      : 'border-surface-border bg-surface-raised text-ink-muted hover:border-brand/30 hover:text-ink'
  }`
}

function dayChipCls(active: boolean) {
  return `w-10 h-10 flex items-center justify-center rounded-xl border text-sm font-semibold transition-colors ${
    active
      ? 'border-brand/50 bg-brand/15 text-brand-light'
      : 'border-surface-border bg-surface-raised text-ink-muted hover:border-brand/30 hover:text-ink'
  }`
}

/**
 * El ciclo que el Plan Builder construye, en el orden en que se entrena.
 * Es la sustancia de la oferta: en vez de tres promesas genéricas, mostramos
 * el macrociclo real y su vocabulario, que es el mismo del dashboard.
 */
const UPGRADE_PHASE_LADDER: { phase: MacroPlanPhase; focus: string }[] = [
  { phase: 'base', focus: 'Construyes volumen y resistencia.' },
  { phase: 'build', focus: 'Subes carga y trabajo específico.' },
  { phase: 'peak', focus: 'Afinas la intensidad.' },
  { phase: 'taper', focus: 'Bajas volumen para llegar fresco.' },
  { phase: 'race', focus: 'La semana que estabas preparando.' },
]

/** Contenedor común: el CTA, la espera y el wizard ocupan el mismo ancho. */
function CompetitionPlanGateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg px-4 pb-6 pt-10 md:px-6">
      {children}
    </div>
  )
}

/**
 * Free puede consultar un plan que ya recibió, pero no iniciar ni modificar
 * planificación. Cuando no existe un plan materializado, no mostramos el
 * wizard: evita pedir siete datos para descubrir el requisito al final.
 */
function CompetitionPlanUpgradeGate({ onViewPlans, onGoHome }: {
  onViewPlans: () => void
  onGoHome: () => void
}) {
  return (
    <CompetitionPlanGateLayout>
      <section className="hud-border overflow-hidden rounded-3xl border border-brand/25 bg-[radial-gradient(circle_at_top_right,rgba(255,77,0,0.18),transparent_46%),linear-gradient(155deg,rgba(28,18,13,0.98),rgba(13,13,13,0.98))] p-6 shadow-[0_24px_70px_-38px_rgba(255,77,0,0.65)] [--hud-accent-end:rgba(255,77,0,0.12)] [--hud-accent-start:rgba(255,122,51,0.34)]">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-brand-light">
          Plan Avanzado
        </p>
        <h1 className="text-balance mt-2.5 font-display text-[1.75rem] font-extrabold leading-[1.08] tracking-tight text-ink">
          Planifica tu próximo objetivo
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Un plan de competencia ordena las semanas que te separan de tu evento y
          genera cada una lista para entrenar.
        </p>

        <p className="mt-7 font-mono text-[9.5px] font-semibold uppercase tracking-[0.24em] text-ink-muted">
          Cómo se ordena el ciclo
        </p>
        <div className="relative mt-4">
          {/* Hairline que enhebra las cuentas de centro a centro y se enciende
              hacia el evento: el ciclo tiene dirección, no es una lista. */}
          <span
            aria-hidden
            className="absolute bottom-[14px] left-[14px] top-[14px] w-px bg-[linear-gradient(180deg,rgba(110,110,115,0.45),rgba(255,122,51,0.5)_58%,#ff4d00)]"
          />
          <ol className="relative space-y-3.5">
            {UPGRADE_PHASE_LADDER.map(({ phase, focus }, index) => {
              const isEvent = phase === 'race'
              return (
                <li key={phase} className="flex items-start gap-3.5">
                  <span
                    aria-hidden
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
                      isEvent
                        ? 'bg-brand text-[#1a0800] shadow-[0_0_18px_-4px_rgba(255,77,0,0.95)]'
                        : 'border border-white/10 bg-[#0b0a09] text-ink-muted'
                    }`}
                  >
                    {isEvent ? <Target size={13} strokeWidth={2.4} /> : index + 1}
                  </span>
                  <span className="min-w-0 pt-[3px]">
                    <span className={`block font-display text-sm font-bold leading-tight ${isEvent ? 'text-brand-light' : 'text-ink'}`}>
                      {getPhaseLabel(phase)}
                    </span>
                    <span className="mt-1 block text-[13px] leading-snug text-ink-muted">
                      {focus}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>
        </div>

        <button
          type="button"
          onClick={onViewPlans}
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3.5 font-display text-sm font-bold text-[#1a0800] shadow-[0_12px_28px_-14px_rgba(255,77,0,0.9)] transition-colors hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
        >
          Ver planes
          <ChevronRight size={16} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onGoHome}
          className="mt-1.5 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
        >
          Volver al inicio
        </button>
        <p className="mt-4 text-center text-xs leading-relaxed text-ink-muted">
          Mientras tanto sigues hablando con RallyIQ y registrando tus entrenamientos.
        </p>
      </section>
    </CompetitionPlanGateLayout>
  )
}

function CompetitionPlanAccessLoading() {
  return (
    <CompetitionPlanGateLayout>
      <div
        role="status"
        className="rounded-3xl border border-surface-border bg-surface-card/70 p-6"
      >
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-ink-muted">
          Plan de competencia
        </p>
        <p className="mt-2.5 text-sm text-ink-muted">
          Revisando tu plan…
        </p>
      </div>
    </CompetitionPlanGateLayout>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CompetitionPlanPage() {
  const navigate = useNavigate()
  const { athleteProfile, saveAthleteProfile } = useCoachMemoryStore()
  const { allWeekSummaries, loadAllSummaries } = useTrainingStore()
  const { canUse, pending: entitlementPending } = useEntitlement()
  const activeAthleteId = useAuthStore((state) => state.activeAthleteId)
  const lastSuccessfulSyncAt = useAuthStore((state) => state.syncDetails.lastSuccessfulSyncAt)
  const syncAttemptInFlight = useAuthStore((state) => state.syncDetails.syncAttemptInFlight)
  // `null` conserva la semántica legacy/self hasta que se hidrate el scope,
  // pero no debe confundirse con una consulta ya resuelta de otro atleta.
  const activePlanScopeKey = activeAthleteId ?? '__legacy_or_self__'
  const now = useMemo(() => new Date(), [])
  const enabledSports = getEnabledSports(athleteProfile)
  const existingEvent = getPrimaryGoalEvent(athleteProfile)
  const existingConfig = athleteProfile?.planWizardConfig

  const [step, setStep] = useState(1)
  const [wizardMode, setWizardMode] = useState<WizardMode>(null)
  const [cycleToCloseGoalEventId, setCycleToCloseGoalEventId] = useState<string | null>(null)
  const [isUsingPreviousConfig, setIsUsingPreviousConfig] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showDeletePlanConfirm, setShowDeletePlanConfirm] = useState(false)
  const [hasActiveGeneratedPlan, setHasActiveGeneratedPlan] = useState(false)
  const [resolvedActivePlanScopeKey, setResolvedActivePlanScopeKey] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [state, setState] = useState<WizardState>(() =>
    initWizardState(athleteProfile, existingEvent, existingConfig)
  )

  const refreshActiveGeneratedPlan = useCallback(async (
    scopeKey: string,
    isMounted: () => boolean,
  ) => {
    // La tabla puede cambiar cuando termina el pull inicial o al alternar el
    // atleta activo. Capturamos el scope para no adoptar un resultado tardío
    // perteneciente al atleta que acabamos de abandonar.
    const athleteIdAtStart = getActiveAthleteId()
    const switchEpochAtStart = getSwitchEpoch()

    try {
      const all = await db.trainingPlans.toArray()
      if (!isMounted() || (
        getActiveAthleteId() !== athleteIdAtStart
        || getSwitchEpoch() !== switchEpochAtStart
      )) return

      const active = filterRowsToActiveScope(all)
        .filter((plan) => plan.status === 'active')
      setHasActiveGeneratedPlan(active.length > 0)
    } catch {
      // Si el almacenamiento local falla, Free sigue viendo la oferta. Nunca
      // dejamos la ruta bloqueada en una espera infinita.
      if (isMounted() && (
        getActiveAthleteId() === athleteIdAtStart
        && getSwitchEpoch() === switchEpochAtStart
      )) setHasActiveGeneratedPlan(false)
    } finally {
      if (isMounted() && (
        getActiveAthleteId() === athleteIdAtStart
        && getSwitchEpoch() === switchEpochAtStart
      )) setResolvedActivePlanScopeKey(scopeKey)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void refreshActiveGeneratedPlan(activePlanScopeKey, () => !cancelled)
    return () => {
      cancelled = true
    }
  }, [activePlanScopeKey, lastSuccessfulSyncAt, refreshActiveGeneratedPlan, syncAttemptInFlight])

  useEffect(() => {
    void loadAllSummaries()
  }, [loadAllSummaries])

  const update = (patch: Partial<WizardState>) =>
    setState(prev => ({ ...prev, ...patch }))
  const updateWith = (recipe: (prev: WizardState) => WizardState) =>
    setState(prev => recipe(prev))

  // Compute macro plan context for the summary step
  const macroPlan = useMemo(() => computeMacroPlan(athleteProfile), [athleteProfile])
  const macroPlanPhaseLabel = macroPlan ? getPhaseLabel(macroPlan.currentPhase) : undefined
  const hasSavedPlan = Boolean(existingEvent || existingConfig || hasActiveGeneratedPlan)
  const canManageCompetitionPlan = canUse('plan_builder_week')
  const hasResolvedActiveGeneratedPlan = resolvedActivePlanScopeKey === activePlanScopeKey

  // Derive primary sport from event type
  const primarySportForEvent = useMemo<SupportedSport | null>(() => {
    return getSportForEventType(state.eventType)
  }, [state.eventType])

  // Sports available for complementary (excluding the event's primary sport)
  const availableComplementarySports = useMemo(
    () => enabledSports.filter(s => s !== primarySportForEvent),
    [enabledSports, primarySportForEvent],
  )
  const planWindow = useMemo(
    () => getPlanWindow(state.eventDate, state.trainingDays, now, state.eventEndDate || undefined),
    [now, state.eventDate, state.eventEndDate, state.trainingDays],
  )
  const goalEventWindowIsValid = useMemo(() => (
    state.eventDate.length > 0
    && validateGoalEventWindow({
      date: state.eventDate,
      endDate: state.eventEndDate || undefined,
      keyDate: state.eventKeyDate || undefined,
    }).length === 0
  ), [state.eventDate, state.eventEndDate, state.eventKeyDate])

  // Step validation
  const canContinue = useMemo(() => {
    switch (step) {
      case 1: return !!state.eventType && state.eventTitle.trim().length > 0
      case 2: return goalEventWindowIsValid && planWindow.isFuture && !planWindow.exceedsMax
      case 3: return !!state.objective && !!state.competitiveLevel
      case 4: return state.trainingDays.length > 0 && !!state.sessionsPerWeek && !!state.sessionDurationMins
      case 5: return true  // complementary sports optional
      case 6: return !!state.fitnessLevel && !!state.fatigue
      case 7: return true
      default: return true
    }
  }, [goalEventWindowIsValid, planWindow.exceedsMax, planWindow.isFuture, state, step])

  function goNext() {
    if (step < TOTAL_STEPS) setStep(s => s + 1)
  }

  function goBack() {
    if (step > 1) setStep(s => s - 1)
    else if (window.history.length > 1) navigate(-1)
    else navigate(ROUTES.SETTINGS)
  }

  function openEditPlan() {
    if (!canManageCompetitionPlan) return
    setState(initWizardState(athleteProfile, existingEvent, existingConfig))
    setStep(1)
    setDeleteError(null)
    setCycleToCloseGoalEventId(null)
    setIsUsingPreviousConfig(false)
    setWizardMode('edit')
  }

  function openNewCycle(goalEventId: string) {
    if (!canManageCompetitionPlan) return
    usePlanBuilderStore.getState().resetBuilderState()
    setState(initWizardStateForNewCycle(athleteProfile, existingEvent, existingConfig))
    setStep(1)
    setDeleteError(null)
    setCycleToCloseGoalEventId(goalEventId)
    setIsUsingPreviousConfig(Boolean(existingEvent || existingConfig))
    setWizardMode('new_cycle')
  }

  function startNewCycleFromScratch() {
    setState(initWizardState(athleteProfile, undefined, undefined))
    setIsUsingPreviousConfig(false)
  }

  async function handleDeletePlan() {
    if (isSaving || !hasSavedPlan) return
    const athleteIdAtStart = getActiveAthleteId()
    const switchEpochAtStart = getSwitchEpoch()
    if (!athleteIdAtStart) {
      setDeleteError('No se pudo identificar al atleta activo. Reintentá en unos segundos.')
      return
    }

    setIsSaving(true)
    try {
      const all = await db.trainingPlans.toArray()
      if (!isStableAthleteOperation(athleteIdAtStart, switchEpochAtStart)) return
      const active = filterRowsToActiveScope(all)
        .filter((plan) => plan.status === 'active')
      const results = await Promise.all(active.map((plan) => deletePlanCycle(plan.id)))
      if (!isStableAthleteOperation(athleteIdAtStart, switchEpochAtStart)) return

      if (results.some((result) => result !== 'deleted')) {
        setDeleteError(results.includes('failed')
          ? 'No se pudo eliminar el plan. Revisá tu conexión y reintentá.'
          : 'El borrado quedó pendiente de sincronización. Conservamos tu configuración; reintentá cuando vuelva la conexión.')
        return
      }

      usePlanBuilderStore.getState().resetBuilderState()
      setHasActiveGeneratedPlan(false)
      if (!isStableAthleteOperation(athleteIdAtStart, switchEpochAtStart)) return
      await saveAthleteProfile({
        goalEvents: [],
        planWizardConfig: undefined,
        macroPlan: undefined,
      })
      if (!isStableAthleteOperation(athleteIdAtStart, switchEpochAtStart)) return
      setState(initWizardState(athleteProfile, undefined, undefined))
      setStep(1)
      setWizardMode(null)
      setCycleToCloseGoalEventId(null)
      setIsUsingPreviousConfig(false)
      setDeleteError(null)
    } catch {
      setDeleteError('No se pudo eliminar el plan. Revisá tu conexión y reintentá.')
    } finally {
      setIsSaving(false)
      setShowDeletePlanConfirm(false)
    }
  }

  async function handleGenerate() {
    if (!canManageCompetitionPlan || isSaving || !goalEventWindowIsValid || !planWindow.isFuture || planWindow.exceedsMax) return
    const athleteIdAtStart = getActiveAthleteId()
    const switchEpochAtStart = getSwitchEpoch()
    if (!athleteIdAtStart) return
    setIsSaving(true)
    try {
      const now = new Date().toISOString()
      const isNewCycle = wizardMode === 'new_cycle'
      const eventId = isNewCycle ? uuid() : (existingEvent?.id ?? uuid())

      const newEvent = {
        id: eventId,
        title: state.eventTitle.trim(),
        date: state.eventDate,
        // Un término igual al inicio es un evento de un día: no se persiste,
        // para que el dato guardado diga lo mismo que la UI mostró.
        endDate: state.eventEndDate && state.eventEndDate !== state.eventDate
          ? state.eventEndDate
          : undefined,
        keyDate: state.eventKeyDate || undefined,
        sport: primarySportForEvent ?? athleteProfile?.sportContext?.primarySport ?? 'squash',
        priority: 'primary' as const,
        notes: isNewCycle ? undefined : existingEvent?.notes,
        eventType: state.eventType,
        objective: state.objective,
        competitiveLevel: state.competitiveLevel,
      }

      const newConfig = {
        goalEventId: eventId,
        trainingDays: state.trainingDays,
        doubleSessionDays: state.allowDoubleSession
          ? state.doubleSessionDays.filter((day) => state.trainingDays.includes(day))
          : undefined,
        sessionsPerWeek: state.sessionsPerWeek!,
        sessionDurationMins: state.sessionDurationMins!,
        allowDoubleSession: state.allowDoubleSession,
        complementarySports: state.complementarySports,
        currentFitnessLevel: state.fitnessLevel!,
        currentFatigue: state.fatigue!,
        injuryNotes: state.injuryNotes.trim() || undefined,
        createdAt: isNewCycle ? now : (existingConfig?.createdAt ?? now),
        updatedAt: now,
      }

      if (isNewCycle) {
        if (!cycleToCloseGoalEventId) {
          throw new Error('No se pudo identificar el ciclo anterior.')
        }
        await closePlanCycle({ goalEventId: cycleToCloseGoalEventId })
        if (!isStableAthleteOperation(athleteIdAtStart, switchEpochAtStart)) return
      }

      if (!isStableAthleteOperation(athleteIdAtStart, switchEpochAtStart)) return
      await saveAthleteProfile({ goalEvents: [newEvent], planWizardConfig: newConfig })
      if (!isStableAthleteOperation(athleteIdAtStart, switchEpochAtStart)) return

      navigate(ROUTES.PLAN_BUILDER_V2, {
        state: {
          fromWizard: true,
          goalEvent: newEvent,
          wizardConfig: newConfig,
        },
      })
    } catch {
      setIsSaving(false)
    }
  }

  // Resolver entitlement y la presencia del plan antes de decidir entre
  // dashboard de solo lectura y CTA. Así no hay un frame editable para Free.
  if (entitlementPending || (!canManageCompetitionPlan && !hasResolvedActiveGeneratedPlan)) {
    return <CompetitionPlanAccessLoading />
  }

  if (!canManageCompetitionPlan) {
    if (hasActiveGeneratedPlan) {
      return <PlanDashboard onEdit={openEditPlan} onNewCycle={openNewCycle} readOnly />
    }
    return (
      <CompetitionPlanUpgradeGate
        onViewPlans={() => navigate(ROUTES.PRICING)}
        onGoHome={() => navigate(ROUTES.HOME)}
      />
    )
  }

  if (hasSavedPlan && wizardMode == null) {
    return <PlanDashboard onEdit={openEditPlan} onNewCycle={openNewCycle} />
  }

  return (
    <div className="min-h-screen flex flex-col px-4 pt-10 pb-6 md:px-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="mb-6 space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors"
          >
            <ChevronLeft size={16} />
            {step === 1 ? 'Cancelar' : 'Atrás'}
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 text-ink-faint">
            <Target size={14} className="text-brand" />
            <span className="text-xs font-semibold text-brand-light">Plan de competencia</span>
          </div>
        </div>
        <ProgressBar step={step} />
      </div>

      {/* Step content */}
      <div className="flex-1">
        {step === 1 && wizardMode === 'new_cycle' && isUsingPreviousConfig && (
          <div
            role="status"
            className="mb-5 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3"
          >
            <p className="text-sm text-ink-muted">
              {existingEvent ? (
                <>Usamos la configuración de <em className="text-ink">{existingEvent.title}</em>.</>
              ) : (
                <>Usamos la configuración guardada de tu ciclo anterior.</>
              )}
            </p>
            <button
              type="button"
              onClick={startNewCycleFromScratch}
              className="mt-2 text-xs font-semibold text-brand-light hover:text-brand"
            >
              Empezar de cero
            </button>
          </div>
        )}
        {step === 1 && <Step1EventType state={state} update={update} />}
        {step === 2 && <Step2EventDate state={state} update={update} planWindow={planWindow} />}
        {step === 3 && <Step3Objective state={state} update={update} primarySport={primarySportForEvent} />}
        {step === 4 && <Step4Schedule state={state} update={update} updateWith={updateWith} />}
        {step === 5 && (
          <Step5ComplementarySports
            state={state}
            update={update}
            availableSports={availableComplementarySports}
            primarySport={primarySportForEvent}
          />
        )}
        {step === 6 && <Step6CurrentState state={state} update={update} />}
        {step === 7 && (
          <Step7Summary
            state={state}
            planWindow={planWindow}
            macroPlanPhase={macroPlanPhaseLabel}
            primarySport={primarySportForEvent}
          />
        )}

        {step === 1 && (
          <div className="mt-6">
            <CycleHistory weekSummaries={allWeekSummaries} />
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <div className="mt-6 space-y-2">
        {hasSavedPlan && step === 1 && (
          <button
            type="button"
            onClick={() => {
              setDeleteError(null)
              setShowDeletePlanConfirm(true)
            }}
            disabled={isSaving}
            className="w-full flex items-center justify-center gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/5 px-4 py-3 text-sm font-medium text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-50"
          >
            <Trash2 size={15} />
            {isSaving ? 'Eliminando...' : 'Eliminar plan generado'}
          </button>
        )}
        {deleteError && (
          <p role="status" className="text-xs text-rose-300">
            {deleteError}
          </p>
        )}
        {step < TOTAL_STEPS ? (
          <>
            <button
              type="button"
              onClick={goNext}
              disabled={!canContinue}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3.5 text-sm font-semibold text-white transition-all hover:bg-brand-light disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continuar
              <ChevronRight size={16} />
            </button>
            {(step === 5 || step === 6) && (
              <button
                type="button"
                onClick={goNext}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-sm text-ink-faint hover:text-ink-muted transition-colors"
              >
                <SkipForward size={14} />
                Saltar este paso
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => { void handleGenerate() }}
            disabled={isSaving}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3.5 text-sm font-semibold text-white transition-all hover:bg-brand-light disabled:opacity-60"
          >
            <Sparkles size={16} />
            {isSaving ? 'Guardando...' : 'Generar mi plan'}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={showDeletePlanConfirm}
        title="Eliminar plan de competencia"
        message="Esto eliminara el evento principal y la configuracion del plan de competencia. Puedes volver a crearlo despues."
        confirmLabel="Eliminar plan"
        destructive
        isLoading={isSaving}
        onCancel={() => setShowDeletePlanConfirm(false)}
        onConfirm={() => { void handleDeletePlan() }}
      />
    </div>
  )
}

// ─── Step 1: Event type + name ────────────────────────────────────────────────

function Step1EventType({
  state,
  update,
}: {
  state: WizardState
  update: (p: Partial<WizardState>) => void
}) {
  return (
    <div>
      <StepLabel step={1} />
      <Question>¿Qué tipo de evento estás preparando?</Question>
      <Hint>El tipo de evento define cómo distribuimos las cargas y el taper.</Hint>

      <div className="grid grid-cols-2 gap-3 mb-5">
        {EVENT_TYPE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              const selectedPrimarySport = getSportForEventType(opt.value)
              update({
                eventType: opt.value,
                complementarySports: selectedPrimarySport
                  ? state.complementarySports.filter((sport) => sport !== selectedPrimarySport)
                  : state.complementarySports,
              })
            }}
            className={`${chipCls(state.eventType === opt.value)} min-h-[88px] flex flex-col justify-center`}
          >
            <span className="text-xl leading-none mb-2">{opt.emoji}</span>
            <span className="leading-snug">{opt.label}</span>
          </button>
        ))}
      </div>

      <div>
        <label className="text-sm font-medium text-ink block mb-2">Nombre del evento</label>
        <input
          type="text"
          value={state.eventTitle}
          onChange={e => update({ eventTitle: e.target.value })}
          placeholder="Ej: Torneo Master Otoño, Media maratón Valparaíso..."
          className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>
    </div>
  )
}

// ─── Step 2: Event date ───────────────────────────────────────────────────────

function Step2EventDate({
  state,
  update,
  planWindow,
}: {
  state: WizardState
  update: (p: Partial<WizardState>) => void
  planWindow: ReturnType<typeof getPlanWindow>
}) {
  const today = new Date().toISOString().split('T')[0]
  const { totalWeeksUntilEvent, effectivePlanWeeks, exceedsMax, isFuture, maxSelectableDate } = planWindow

  const hasRange = Boolean(state.eventEndDate) && state.eventEndDate !== state.eventDate
  const draftEvent = {
    date: state.eventDate,
    endDate: state.eventEndDate || undefined,
    keyDate: state.eventKeyDate || undefined,
  }
  const windowIssues = state.eventDate ? validateGoalEventWindow(draftEvent) : []
  const keyDateLabel = formatGoalEventKeyDate(draftEvent)
  const issueFor = (field: 'endDate' | 'keyDate') =>
    windowIssues.find((issue) => issue.field === field)?.message

  // Mover el inicio puede dejar término y día clave fuera de rango: se limpian
  // en vez de guardarse inválidos y fallar recién al enviar.
  const changeStart = (nextStart: string) => {
    const keepsEnd = state.eventEndDate && state.eventEndDate >= nextStart
    const nextEnd = keepsEnd ? state.eventEndDate : ''
    const keepsKey = state.eventKeyDate
      && state.eventKeyDate >= nextStart
      && state.eventKeyDate <= (nextEnd || nextStart)
    update({
      eventDate: nextStart,
      eventEndDate: nextEnd,
      eventKeyDate: keepsKey ? state.eventKeyDate : '',
    })
  }

  const changeEnd = (nextEnd: string) => {
    const keepsKey = state.eventKeyDate
      && state.eventKeyDate >= state.eventDate
      && state.eventKeyDate <= (nextEnd || state.eventDate)
    update({ eventEndDate: nextEnd, eventKeyDate: keepsKey ? state.eventKeyDate : '' })
  }

  return (
    <div>
      <StepLabel step={2} />
      <Question>¿Cuándo es el evento?</Question>
      <Hint>La fecha es el ancla de todo el plan. Puedo ajustar si cambia después, pero el plan de competencia se limita a un máximo de 12 semanas.</Hint>

      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted" htmlFor="event-start-date">
        Inicio del evento
      </label>
      <input
        id="event-start-date"
        type="date"
        value={state.eventDate}
        min={today}
        max={maxSelectableDate}
        onChange={e => changeStart(e.target.value)}
        className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
      />

      {state.eventDate && (
        <div className="mt-3">
          {!state.eventEndDate ? (
            <button
              type="button"
              onClick={() => changeEnd(state.eventDate)}
              className="text-xs font-medium text-brand-light underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-brand/30 rounded"
            >
              El evento dura varios días
            </button>
          ) : (
            <>
              <div className="flex items-end justify-between gap-3">
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted" htmlFor="event-end-date">
                  Término del evento
                </label>
                <button
                  type="button"
                  onClick={() => update({ eventEndDate: '', eventKeyDate: '' })}
                  className="mb-1.5 text-xs text-ink-muted underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-brand/30 rounded"
                >
                  Es de un día
                </button>
              </div>
              <input
                id="event-end-date"
                type="date"
                value={state.eventEndDate}
                min={state.eventDate}
                onChange={e => changeEnd(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              {issueFor('endDate') && (
                <p role="alert" className="mt-1.5 text-xs text-rose-400">{issueFor('endDate')}</p>
              )}
            </>
          )}
        </div>
      )}

      {/* El día clave sólo existe dentro de una ventana de varios días. */}
      {hasRange && !issueFor('endDate') && (
        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted" htmlFor="event-key-date">
            Día clave <span className="normal-case tracking-normal text-ink-muted/70">(opcional)</span>
          </label>
          <input
            id="event-key-date"
            type="date"
            value={state.eventKeyDate}
            min={state.eventDate}
            max={state.eventEndDate}
            onChange={e => update({ eventKeyDate: e.target.value })}
            className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            Día en que esperas los partidos más exigentes.
          </p>
          {issueFor('keyDate') && (
            <p role="alert" className="mt-1.5 text-xs text-rose-400">{issueFor('keyDate')}</p>
          )}
        </div>
      )}

      <div className="mb-4" />

      {state.eventDate && isFuture && !exceedsMax && (
        <div className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            {effectivePlanWeeks} semana{effectivePlanWeeks !== 1 ? 's' : ''} a planificar
          </p>
          <p className="text-xs text-ink-muted mt-0.5">
            Fases estimadas: <span className="text-brand-light">{phasesFromWeeks(effectivePlanWeeks)}</span>
          </p>
          {windowIssues.length === 0 && (
            <p className="mt-2 border-t border-brand/15 pt-2 text-xs text-ink-muted">
              Evento: <span className="text-ink">{formatGoalEventWindow(draftEvent)}</span>
              {keyDateLabel && <> · {keyDateLabel}</>}
            </p>
          )}
        </div>
      )}
      {state.eventDate && exceedsMax && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 space-y-3">
          <div>
            <p className="text-sm font-semibold text-amber-300">
              Máximo {MAX_COMPETITION_PLAN_WEEKS} semanas
            </p>
            <p className="mt-1 text-xs text-amber-200 leading-relaxed">
              Tu evento está a {totalWeeksUntilEvent} semanas. Para preparar bien una competencia trabajamos con un máximo de {MAX_COMPETITION_PLAN_WEEKS} semanas, y no se puede agregar más desde aquí. Puedes ajustarlo después si lo necesitas.
            </p>
          </div>
          <button
            type="button"
            onClick={() => changeStart(maxSelectableDate)}
            className="inline-flex items-center justify-center rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-400/15"
          >
            Usar máximo permitido
          </button>
        </div>
      )}
      {state.eventDate && !isFuture && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
          <p className="text-sm text-rose-400">La fecha debe ser en el futuro.</p>
        </div>
      )}
      {state.eventDate && isFuture && effectivePlanWeeks <= 2 && (
        <p className="mt-2 text-xs text-amber-400">
          Con menos de 2 semanas el plan será de peak/taper directo, sin fases de base o build.
        </p>
      )}
    </div>
  )
}

// ─── Step 3: Objective + level ────────────────────────────────────────────────

function Step3Objective({
  state,
  update,
  primarySport,
}: {
  state: WizardState
  update: (p: Partial<WizardState>) => void
  primarySport: SupportedSport | null
}) {
  const levelOptions = getLevelOptionsForSport(primarySport)
  return (
    <div>
      <StepLabel step={3} />
      <Question>¿Qué quieres lograr en este evento?</Question>
      <Hint>Tu objetivo cambia el tipo de estímulos que priorizo y la intensidad del taper.</Hint>

      <div className="space-y-2 mb-6">
        {OBJECTIVE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => update({ objective: opt.value })}
            className={`${chipCls(state.objective === opt.value)} w-full`}
          >
            <span className="block font-medium">{opt.label}</span>
            <span className="block text-xs text-ink-faint mt-0.5">{opt.sub}</span>
          </button>
        ))}
      </div>

      <label className="text-sm font-medium text-ink block mb-2">Nivel competitivo</label>
      <div className="flex flex-wrap gap-2">
        {levelOptions.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => update({ competitiveLevel: opt.value })}
            className={chipCls(state.competitiveLevel === opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Step 4: Schedule ─────────────────────────────────────────────────────────

function Step4Schedule({
  state,
  update,
  updateWith,
}: {
  state: WizardState
  update: (p: Partial<WizardState>) => void
  updateWith: (recipe: (prev: WizardState) => WizardState) => void
}) {
  function toggleDay(day: DayOfWeek) {
    updateWith((current) => {
      const trainingDays = toggleOrderedValue(current.trainingDays, day, DAY_OF_WEEK_ORDER)
      const doubleSessionDays = current.doubleSessionDays.filter((item) => trainingDays.includes(item))
      return {
        ...current,
        trainingDays,
        doubleSessionDays,
        sessionsPerWeek: clampSessionsPerWeekToAvailability(
          current.sessionsPerWeek,
          trainingDays,
          current.allowDoubleSession,
          doubleSessionDays,
        ),
      }
    })
  }

  function replaceTrainingDays(days: DayOfWeek[]) {
    updateWith((current) => {
      const trainingDays = replaceOrderedValues(current.trainingDays, days, DAY_OF_WEEK_ORDER)
      const doubleSessionDays = current.doubleSessionDays.filter((item) => trainingDays.includes(item))
      return {
        ...current,
        trainingDays,
        doubleSessionDays,
        sessionsPerWeek: clampSessionsPerWeekToAvailability(
          current.sessionsPerWeek,
          trainingDays,
          current.allowDoubleSession,
          doubleSessionDays,
        ),
      }
    })
  }

  function toggleDoubleDay(day: DayOfWeek) {
    updateWith((current) => {
      const doubleSessionDays = toggleOrderedValue(current.doubleSessionDays, day, DAY_OF_WEEK_ORDER)
        .filter((item) => current.trainingDays.includes(item))
      return {
        ...current,
        doubleSessionDays,
        allowDoubleSession: doubleSessionDays.length > 0,
        sessionsPerWeek: clampSessionsPerWeekToAvailability(
          current.sessionsPerWeek,
          current.trainingDays,
          doubleSessionDays.length > 0,
          doubleSessionDays,
        ),
      }
    })
  }

  const maxSessions = getSessionCapacityFromAvailability(
    state.trainingDays,
    state.allowDoubleSession,
    state.doubleSessionDays,
  )

  return (
    <div>
      <StepLabel step={4} />
      <Question>¿Cuándo y cuánto puedes entrenar?</Question>
      <Hint>Con esto diseño la carga real que puedes sostener, sin comprometerte de más.</Hint>

      <label className="text-sm font-medium text-ink block mb-2">Días disponibles</label>
      <div className="flex flex-wrap gap-2 mb-3">
        <button type="button" onClick={() => replaceTrainingDays(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])} className={chipCls(false)}>
          L-V
        </button>
        <button type="button" onClick={() => replaceTrainingDays(['saturday', 'sunday'])} className={chipCls(false)}>
          Fin de semana
        </button>
        <button type="button" onClick={() => replaceTrainingDays([...DAY_OF_WEEK_ORDER])} className={chipCls(false)}>
          Toda la semana
        </button>
        <button type="button" onClick={() => replaceTrainingDays([])} className={chipCls(false)}>
          Limpiar
        </button>
      </div>
      <div className="flex gap-2 mb-5">
        {DAYS_OF_WEEK.map(d => (
          <button
            key={d.value}
            type="button"
            onClick={() => toggleDay(d.value)}
            className={dayChipCls(state.trainingDays.includes(d.value))}
          >
            {d.short}
          </button>
        ))}
      </div>

      <label className="text-sm font-medium text-ink block mb-2">Sesiones por semana</label>
      <div className="flex flex-wrap gap-2 mb-5">
        {SESSIONS_PER_WEEK_OPTIONS.map(n => (
          <button
            key={n}
            type="button"
            onClick={() => update({ sessionsPerWeek: n })}
            disabled={maxSessions > 0 ? n > maxSessions : true}
            className={`${chipCls(state.sessionsPerWeek === n)} disabled:cursor-not-allowed disabled:opacity-30`}
          >
            {n}
          </button>
        ))}
      </div>
      {state.trainingDays.length > 0 && (
        <p className="text-xs text-ink-faint mb-5">
          Máximo posible con tu selección actual: {maxSessions} sesión(es){state.allowDoubleSession ? ' considerando doble sesión.' : ' sin doble sesión.'}
        </p>
      )}

      <label className="text-sm font-medium text-ink block mb-2">Duración por sesión</label>
      <div className="flex flex-wrap gap-2 mb-5">
        {SESSION_DURATION_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => update({ sessionDurationMins: opt.value })}
            className={chipCls(state.sessionDurationMins === opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised px-4 py-3">
        <div>
          <p className="text-sm font-medium text-ink">¿Doble sesión algunos días?</p>
          <p className="text-xs text-ink-muted">Mañana + tarde cuando la carga lo requiera</p>
        </div>
        <button
          type="button"
          onClick={() => updateWith((current) => {
            const allowDoubleSession = !current.allowDoubleSession
            const doubleSessionDays = allowDoubleSession
              ? (current.doubleSessionDays.length > 0 ? current.doubleSessionDays : current.trainingDays)
              : []
            return {
              ...current,
              allowDoubleSession,
              doubleSessionDays,
              sessionsPerWeek: clampSessionsPerWeekToAvailability(
                current.sessionsPerWeek,
                current.trainingDays,
                allowDoubleSession,
                doubleSessionDays,
              ),
            }
          })}
          className={`relative w-11 h-6 rounded-full transition-colors ${state.allowDoubleSession ? 'bg-brand' : 'bg-surface-border'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${state.allowDoubleSession ? 'translate-x-5' : ''}`}
          />
        </button>
      </div>
      {state.allowDoubleSession && (
        <div className="mt-4">
          <label className="text-sm font-medium text-ink block mb-2">Días aptos para doble sesión</label>
          <div className="flex gap-2">
            {DAYS_OF_WEEK.map(d => {
              const enabled = state.trainingDays.includes(d.value)
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDoubleDay(d.value)}
                  disabled={!enabled}
                  className={`${dayChipCls(state.doubleSessionDays.includes(d.value))} disabled:cursor-not-allowed disabled:opacity-30`}
                >
                  {d.short}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Step 5: Complementary sports ────────────────────────────────────────────

function Step5ComplementarySports({
  state,
  update,
  availableSports,
  primarySport,
}: {
  state: WizardState
  update: (p: Partial<WizardState>) => void
  availableSports: SupportedSport[]
  primarySport: SupportedSport | null
}) {
  function toggleSport(sport: SupportedSport) {
    const sports = state.complementarySports.includes(sport)
      ? state.complementarySports.filter(s => s !== sport)
      : [...state.complementarySports, sport]
    update({ complementarySports: sports })
  }

  return (
    <div>
      <StepLabel step={5} />
      <Question>¿Qué deportes complementarios incluimos?</Question>
      <Hint>
        Los incluyo como recuperación activa o carga complementaria según la fase.
        {primarySport && (
          <> El deporte principal del evento (<strong>{SPORT_LABELS[primarySport]}</strong>) no se listan aquí.</>
        )}
      </Hint>

      {availableSports.length === 0 ? (
        <div className="rounded-xl border border-surface-border bg-surface-raised px-4 py-4 text-sm text-ink-muted">
          No hay deportes complementarios configurados en tu perfil.
          <br />
          <span className="text-xs text-ink-faint">Puedes agregarlos en Ajustes → Deportes.</span>
        </div>
      ) : (
        <div className="space-y-2">
          {availableSports.map(sport => (
            <button
              key={sport}
              type="button"
              onClick={() => toggleSport(sport)}
              className={`${chipCls(state.complementarySports.includes(sport))} w-full`}
            >
              <span className="mr-2">{SPORT_EMOJI[sport]}</span>
              {SPORT_LABELS[sport]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Step 6: Current state ────────────────────────────────────────────────────

function Step6CurrentState({
  state,
  update,
}: {
  state: WizardState
  update: (p: Partial<WizardState>) => void
}) {
  const strengthSafetyFeedback = useMemo(() => formatStrengthConstraintFeedback(
    resolveStrengthSafetyConstraints({
      injuryNotes: state.injuryNotes,
      userMessages: [],
    }),
  ), [state.injuryNotes])

  return (
    <div>
      <StepLabel step={6} />
      <Question>¿Cómo estás ahora?</Question>
      <Hint>
        Esto determina si arrancamos con fase base o directamente build, y cómo dosificamos el primer bloque.
      </Hint>

      <label className="text-sm font-medium text-ink block mb-2">Forma física actual</label>
      <div className="space-y-2 mb-5">
        {FITNESS_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => update({ fitnessLevel: opt.value })}
            className={`${chipCls(state.fitnessLevel === opt.value)} w-full`}
          >
            <span className="block font-medium">{opt.label}</span>
            <span className="block text-xs text-ink-faint mt-0.5">{opt.sub}</span>
          </button>
        ))}
      </div>

      <label className="text-sm font-medium text-ink block mb-2">Fatiga acumulada</label>
      <div className="flex flex-wrap gap-2 mb-5">
        {FATIGUE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => update({ fatigue: opt.value })}
            className={chipCls(state.fatigue === opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <label className="text-sm font-medium text-ink block mb-2">
        Molestias o restricciones
        <span className="ml-1.5 text-xs font-normal text-ink-faint">opcional</span>
      </label>
      <textarea
        value={state.injuryNotes}
        onChange={e => update({ injuryNotes: e.target.value })}
        rows={3}
        placeholder="Ej: molestia en rodilla derecha, evitar impacto alto..."
        className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
      {strengthSafetyFeedback && (
        <p className="mt-1.5 text-xs text-ink-faint">{strengthSafetyFeedback}</p>
      )}
    </div>
  )
}

// ─── Step 7: Summary ─────────────────────────────────────────────────────────

function Step7Summary({
  state,
  planWindow,
  macroPlanPhase,
  primarySport,
}: {
  state: WizardState
  planWindow: ReturnType<typeof getPlanWindow>
  macroPlanPhase?: string
  primarySport: SupportedSport | null
}) {
  const eventTypeLabel = EVENT_TYPE_OPTIONS.find(o => o.value === state.eventType)?.label ?? '—'
  const objectiveLabel = OBJECTIVE_OPTIONS.find(o => o.value === state.objective)?.label ?? '—'
  const levelLabel = getLevelOptionsForSport(primarySport).find(o => o.value === state.competitiveLevel)?.label ?? '—'
  const fitnessLabel = FITNESS_OPTIONS.find(o => o.value === state.fitnessLevel)?.label ?? '—'
  const fatigueLabel = FATIGUE_OPTIONS.find(o => o.value === state.fatigue)?.label ?? '—'

  const dayLabels = state.trainingDays
    .map(d => DAYS_OF_WEEK.find(o => o.value === d)?.short ?? d)
    .join(' · ')

  const durationLabel = SESSION_DURATION_OPTIONS.find(o => o.value === state.sessionDurationMins)?.label ?? '—'

  const phases = phasesFromWeeks(planWindow.effectivePlanWeeks)
  const eventWindow = {
    date: state.eventDate,
    endDate: state.eventEndDate || undefined,
    keyDate: state.eventKeyDate || undefined,
  }
  const eventWindowLabel = formatGoalEventWindow(eventWindow)
  const eventKeyDateLabel = formatGoalEventKeyDate(eventWindow)

  return (
    <div>
      <StepLabel step={7} />
      <Question>Tu plan de competencia</Question>
      <Hint>
        Con esta información voy a crear tu plan semana a semana, con sesiones clave, taper y deportes complementarios calibrados a ti.
      </Hint>

      {/* Event summary */}
      <SummaryCard
        title="Evento"
        rows={[
          { label: 'Nombre', value: state.eventTitle },
          { label: 'Tipo', value: eventTypeLabel },
          {
            label: 'Fecha',
            value: planWindow.exceedsMax
              ? `${eventWindowLabel}${eventKeyDateLabel ? ` · ${eventKeyDateLabel}` : ''} · ${planWindow.totalWeeksUntilEvent} semanas al evento (${planWindow.effectivePlanWeeks} generadas)`
              : `${eventWindowLabel}${eventKeyDateLabel ? ` · ${eventKeyDateLabel}` : ''} · ${planWindow.effectivePlanWeeks} semanas incluyendo competencia`,
          },
          { label: 'Objetivo', value: objectiveLabel },
          { label: 'Nivel', value: levelLabel },
        ]}
      />

      {/* Phase timeline */}
      <div className="rounded-xl border border-surface-border bg-surface-raised px-4 py-3 mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint mb-2">Fases estimadas</p>
        <p className="text-sm font-medium text-brand-light">{phases}</p>
        {planWindow.exceedsMax && (
          <p className="text-xs text-brand-light mt-1 leading-relaxed">
            Se crearán hasta {MAX_COMPETITION_PLAN_WEEKS} semanas terminando en la semana del evento. Es el máximo disponible para un plan de competencia.
          </p>
        )}
        {macroPlanPhase && (
          <p className="text-xs text-ink-muted mt-1">Fase actual del macroplan: {macroPlanPhase}</p>
        )}
      </div>

      {/* Training schedule */}
      <SummaryCard
        title="Entrenamiento"
        rows={[
          { label: 'Días', value: dayLabels || '—' },
          { label: 'Sesiones/semana', value: state.sessionsPerWeek?.toString() ?? '—' },
          { label: 'Duración', value: durationLabel },
          { label: 'Doble sesión', value: state.allowDoubleSession ? 'Sí' : 'No' },
          {
            label: 'Complementarios',
            value: state.complementarySports.length > 0
              ? state.complementarySports.map(s => SPORT_LABELS[s]).join(', ')
              : 'Ninguno',
          },
          ...(primarySport ? [{ label: 'Deporte principal', value: SPORT_LABELS[primarySport] }] : []),
        ]}
      />

      {/* Current state */}
      <SummaryCard
        title="Estado actual"
        rows={[
          { label: 'Forma física', value: fitnessLabel },
          { label: 'Fatiga', value: fatigueLabel },
          ...(state.injuryNotes.trim() ? [{ label: 'Molestias', value: state.injuryNotes.trim() }] : []),
        ]}
      />
    </div>
  )
}

function SummaryCard({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised px-4 py-3 mb-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint mb-2">{title}</p>
      <div className="space-y-1.5">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex justify-between gap-4 text-sm">
            <span className="text-ink-muted flex-shrink-0">{label}</span>
            <span className="text-ink text-right truncate">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
