import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Target, Sparkles, SkipForward } from 'lucide-react'
import { ROUTES } from '../constants/routes'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { computeMacroPlan, getPrimaryGoalEvent, getPhaseLabel } from '../services/macroPlan'
import { getEnabledSports } from '../utils/athlete'
import { v4 as uuid } from '../utils/uuid'
import type {
  GoalEventType,
  GoalEventObjective,
  GoalEventLevel,
  DayOfWeek,
  WizardFitnessLevel,
  WizardFatigueLevel,
  SupportedSport,
} from '../types'

// ─── Step definitions ──────────────────────────────────────────────────────────

const TOTAL_STEPS = 7

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

const LEVEL_OPTIONS: { value: GoalEventLevel; label: string }[] = [
  { value: 'recreational', label: 'Recreativo' },
  { value: 'competitive',  label: 'Competitivo amateur' },
  { value: 'masters',      label: 'Masters / Veterano' },
  { value: 'elite',        label: 'Elite amateur' },
]

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

const SESSIONS_PER_WEEK_OPTIONS = [2, 3, 4, 5, 6]

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
  objective?: GoalEventObjective
  competitiveLevel?: GoalEventLevel
  trainingDays: DayOfWeek[]
  sessionsPerWeek?: number
  sessionDurationMins?: number
  allowDoubleSession: boolean
  complementarySports: SupportedSport[]
  fitnessLevel?: WizardFitnessLevel
  fatigue?: WizardFatigueLevel
  injuryNotes: string
}

function initWizardState(
  existingEvent: ReturnType<typeof getPrimaryGoalEvent>,
  existingConfig: import('../types').PlanWizardConfig | undefined,
  enabledSports: SupportedSport[],
): WizardState {
  const primarySportForEvent = existingEvent
    ? (EVENT_TYPE_OPTIONS.find(o => o.sport && enabledSports.includes(o.sport))?.sport ?? null)
    : null

  const defaultComplementary = existingConfig?.complementarySports ??
    enabledSports.filter(s => s !== primarySportForEvent)

  return {
    eventType: existingEvent?.eventType,
    eventTitle: existingEvent?.title ?? '',
    eventDate: existingEvent?.date ?? '',
    objective: existingEvent?.objective,
    competitiveLevel: existingEvent?.competitiveLevel,
    trainingDays: existingConfig?.trainingDays ?? [],
    sessionsPerWeek: existingConfig?.sessionsPerWeek,
    sessionDurationMins: existingConfig?.sessionDurationMins,
    allowDoubleSession: existingConfig?.allowDoubleSession ?? false,
    complementarySports: defaultComplementary,
    fitnessLevel: existingConfig?.currentFitnessLevel,
    fatigue: existingConfig?.currentFatigue,
    injuryNotes: existingConfig?.injuryNotes ?? '',
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function weeksUntil(dateStr: string): number {
  if (!dateStr) return 0
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24 * 7))
}

function phasesFromWeeks(weeks: number): string {
  if (weeks > 12) return 'Base → Build → Peak → Taper'
  if (weeks > 8)  return 'Build → Peak → Taper'
  if (weeks > 4)  return 'Peak → Taper'
  if (weeks > 1)  return 'Taper directo'
  return 'Semana de competencia'
}

function buildCompetitionPrompt(state: WizardState, macroPlanPhase?: string): string {
  const eventType = EVENT_TYPE_OPTIONS.find(o => o.value === state.eventType)?.label ?? 'evento'
  const objectiveLabel = OBJECTIVE_OPTIONS.find(o => o.value === state.objective)?.label ?? ''
  const levelLabel = LEVEL_OPTIONS.find(o => o.value === state.competitiveLevel)?.label ?? ''
  const fitnessLabel = FITNESS_OPTIONS.find(o => o.value === state.fitnessLevel)?.label ?? ''
  const fatigueLabel = FATIGUE_OPTIONS.find(o => o.value === state.fatigue)?.label ?? ''

  const weeks = weeksUntil(state.eventDate)

  const dayLabels = state.trainingDays
    .map(d => DAYS_OF_WEEK.find(o => o.value === d)?.label ?? d)
    .join(', ')

  const compSportsText = state.complementarySports
    .map(s => SPORT_LABELS[s])
    .join(', ')

  const lines: string[] = [
    `Crea mi plan de competencia para "${state.eventTitle}" (${state.eventDate} — ${weeks} semana${weeks !== 1 ? 's' : ''}).`,
    '',
    `Tipo de evento: ${eventType}`,
    objectiveLabel ? `Objetivo: ${objectiveLabel}` : '',
    levelLabel ? `Nivel: ${levelLabel}` : '',
    macroPlanPhase ? `Fase actual del macroplan: ${macroPlanPhase}` : '',
    '',
    '--- Configuración de entrenamiento ---',
    dayLabels ? `Días disponibles: ${dayLabels}` : '',
    state.sessionsPerWeek ? `Sesiones por semana: ${state.sessionsPerWeek}` : '',
    state.sessionDurationMins ? `Duración por sesión: ${state.sessionDurationMins} min` : '',
    `Doble sesión: ${state.allowDoubleSession ? 'sí, algunos días' : 'no'}`,
    compSportsText ? `Deportes complementarios: ${compSportsText}` : '',
    '',
    '--- Estado actual ---',
    fitnessLabel ? `Forma física: ${fitnessLabel}` : '',
    fatigueLabel ? `Fatiga: ${fatigueLabel}` : '',
    state.injuryNotes.trim() ? `Molestias o restricciones: ${state.injuryNotes.trim()}` : '',
  ].filter(line => line !== undefined)

  const prompt = lines.filter(l => l !== '').join('\n').replace(/\n{3,}/g, '\n\n')

  return prompt + '\n\n' +
    'Genera el plan semana a semana desde hoy hasta el evento, con:\n' +
    '1. Distribución por fases y semanas en cada fase\n' +
    '2. Carga semanal por disciplina y sesiones clave de cada fase\n' +
    '3. Protocolo de taper para las semanas finales\n' +
    '4. Indicaciones para deportes complementarios según la fase\n' +
    '5. Reglas de ajuste si sube la fatiga o baja la adherencia'
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CompetitionPlanPage() {
  const navigate = useNavigate()
  const { athleteProfile, saveAthleteProfile } = useCoachMemoryStore()
  const enabledSports = getEnabledSports(athleteProfile)
  const existingEvent = getPrimaryGoalEvent(athleteProfile)
  const existingConfig = athleteProfile?.planWizardConfig

  const [step, setStep] = useState(1)
  const [isSaving, setIsSaving] = useState(false)
  const [state, setState] = useState<WizardState>(() =>
    initWizardState(existingEvent, existingConfig, enabledSports)
  )

  const update = (patch: Partial<WizardState>) =>
    setState(prev => ({ ...prev, ...patch }))

  // Compute macro plan context for the summary step
  const macroPlan = useMemo(() => computeMacroPlan(athleteProfile), [athleteProfile])
  const macroPlanPhaseLabel = macroPlan ? getPhaseLabel(macroPlan.currentPhase) : undefined

  // Derive primary sport from event type
  const primarySportForEvent = useMemo<SupportedSport | null>(() => {
    return EVENT_TYPE_OPTIONS.find(o => o.value === state.eventType)?.sport ?? null
  }, [state.eventType])

  // Sports available for complementary (excluding the event's primary sport)
  const availableComplementarySports = useMemo(
    () => enabledSports.filter(s => s !== primarySportForEvent),
    [enabledSports, primarySportForEvent],
  )

  // Step validation
  const canContinue = useMemo(() => {
    switch (step) {
      case 1: return !!state.eventType && state.eventTitle.trim().length > 0
      case 2: return !!state.eventDate && weeksUntil(state.eventDate) > 0
      case 3: return !!state.objective && !!state.competitiveLevel
      case 4: return state.trainingDays.length > 0 && !!state.sessionsPerWeek && !!state.sessionDurationMins
      case 5: return true  // complementary sports optional
      case 6: return !!state.fitnessLevel && !!state.fatigue
      case 7: return true
      default: return true
    }
  }, [step, state])

  const weeks = state.eventDate ? weeksUntil(state.eventDate) : 0

  function goNext() {
    if (step < TOTAL_STEPS) setStep(s => s + 1)
  }

  function goBack() {
    if (step > 1) setStep(s => s - 1)
    else navigate(-1)
  }

  async function handleGenerate() {
    if (isSaving) return
    setIsSaving(true)
    try {
      const now = new Date().toISOString()
      const eventId = existingEvent?.id ?? uuid()

      const newEvent = {
        id: eventId,
        title: state.eventTitle.trim(),
        date: state.eventDate,
        sport: primarySportForEvent ?? athleteProfile?.sportContext?.primarySport ?? 'squash',
        priority: 'primary' as const,
        notes: existingEvent?.notes,
        eventType: state.eventType,
        objective: state.objective,
        competitiveLevel: state.competitiveLevel,
      }

      const newConfig = {
        goalEventId: eventId,
        trainingDays: state.trainingDays,
        sessionsPerWeek: state.sessionsPerWeek!,
        sessionDurationMins: state.sessionDurationMins!,
        allowDoubleSession: state.allowDoubleSession,
        complementarySports: state.complementarySports,
        currentFitnessLevel: state.fitnessLevel!,
        currentFatigue: state.fatigue!,
        injuryNotes: state.injuryNotes.trim() || undefined,
        createdAt: existingConfig?.createdAt ?? now,
        updatedAt: now,
      }

      await saveAthleteProfile({
        goalEvents: [newEvent],
        planWizardConfig: newConfig,
      })

      const prompt = buildCompetitionPrompt(state, macroPlanPhaseLabel)
      navigate(ROUTES.CHAT, { state: { composerDraft: prompt, fromPlanBuilder: true } })
    } catch {
      setIsSaving(false)
    }
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
        {step === 1 && <Step1EventType state={state} update={update} />}
        {step === 2 && <Step2EventDate state={state} update={update} weeks={weeks} />}
        {step === 3 && <Step3Objective state={state} update={update} />}
        {step === 4 && <Step4Schedule state={state} update={update} />}
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
            weeks={weeks}
            macroPlanPhase={macroPlanPhaseLabel}
            primarySport={primarySportForEvent}
          />
        )}
      </div>

      {/* Footer CTA */}
      <div className="mt-6 space-y-2">
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

      <div className="space-y-2 mb-5">
        {EVENT_TYPE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => update({ eventType: opt.value })}
            className={chipCls(state.eventType === opt.value)}
          >
            <span className="mr-2">{opt.emoji}</span>
            {opt.label}
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
  weeks,
}: {
  state: WizardState
  update: (p: Partial<WizardState>) => void
  weeks: number
}) {
  const today = new Date().toISOString().split('T')[0]

  return (
    <div>
      <StepLabel step={2} />
      <Question>¿Cuándo es el evento?</Question>
      <Hint>La fecha es el ancla de todo el plan. Puedo ajustar si cambia después.</Hint>

      <input
        type="date"
        value={state.eventDate}
        min={today}
        onChange={e => update({ eventDate: e.target.value })}
        className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 mb-4"
      />

      {state.eventDate && weeks > 0 && (
        <div className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            {weeks} semana{weeks !== 1 ? 's' : ''} disponibles
          </p>
          <p className="text-xs text-ink-muted mt-0.5">
            Fases estimadas: <span className="text-brand-light">{phasesFromWeeks(weeks)}</span>
          </p>
        </div>
      )}
      {state.eventDate && weeks <= 0 && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
          <p className="text-sm text-rose-400">La fecha debe ser en el futuro.</p>
        </div>
      )}
      {state.eventDate && weeks > 0 && weeks <= 2 && (
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
}: {
  state: WizardState
  update: (p: Partial<WizardState>) => void
}) {
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
        {LEVEL_OPTIONS.map(opt => (
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
}: {
  state: WizardState
  update: (p: Partial<WizardState>) => void
}) {
  function toggleDay(day: DayOfWeek) {
    const days = state.trainingDays.includes(day)
      ? state.trainingDays.filter(d => d !== day)
      : [...state.trainingDays, day]
    update({ trainingDays: days })
  }

  return (
    <div>
      <StepLabel step={4} />
      <Question>¿Cuándo y cuánto puedes entrenar?</Question>
      <Hint>Con esto diseño la carga real que puedes sostener, sin comprometerte de más.</Hint>

      <label className="text-sm font-medium text-ink block mb-2">Días disponibles</label>
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
            className={chipCls(state.sessionsPerWeek === n)}
          >
            {n}
          </button>
        ))}
      </div>

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
          onClick={() => update({ allowDoubleSession: !state.allowDoubleSession })}
          className={`relative w-11 h-6 rounded-full transition-colors ${state.allowDoubleSession ? 'bg-brand' : 'bg-surface-border'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${state.allowDoubleSession ? 'translate-x-5' : ''}`}
          />
        </button>
      </div>
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
    </div>
  )
}

// ─── Step 7: Summary ─────────────────────────────────────────────────────────

function Step7Summary({
  state,
  weeks,
  macroPlanPhase,
  primarySport,
}: {
  state: WizardState
  weeks: number
  macroPlanPhase?: string
  primarySport: SupportedSport | null
}) {
  const eventTypeLabel = EVENT_TYPE_OPTIONS.find(o => o.value === state.eventType)?.label ?? '—'
  const objectiveLabel = OBJECTIVE_OPTIONS.find(o => o.value === state.objective)?.label ?? '—'
  const levelLabel = LEVEL_OPTIONS.find(o => o.value === state.competitiveLevel)?.label ?? '—'
  const fitnessLabel = FITNESS_OPTIONS.find(o => o.value === state.fitnessLevel)?.label ?? '—'
  const fatigueLabel = FATIGUE_OPTIONS.find(o => o.value === state.fatigue)?.label ?? '—'

  const dayLabels = state.trainingDays
    .map(d => DAYS_OF_WEEK.find(o => o.value === d)?.short ?? d)
    .join(' · ')

  const durationLabel = SESSION_DURATION_OPTIONS.find(o => o.value === state.sessionDurationMins)?.label ?? '—'

  const phases = phasesFromWeeks(weeks)

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
          { label: 'Fecha', value: `${state.eventDate} · ${weeks} semanas` },
          { label: 'Objetivo', value: objectiveLabel },
          { label: 'Nivel', value: levelLabel },
        ]}
      />

      {/* Phase timeline */}
      <div className="rounded-xl border border-surface-border bg-surface-raised px-4 py-3 mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint mb-2">Fases estimadas</p>
        <p className="text-sm font-medium text-brand-light">{phases}</p>
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
