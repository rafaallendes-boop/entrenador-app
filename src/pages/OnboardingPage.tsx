import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import OnboardingChoiceButton from '../components/onboarding/OnboardingChoiceButton'
import OnboardingStepFrame from '../components/onboarding/OnboardingStepFrame'
import { ROUTES } from '../constants/routes'
import { useOnboardingForm } from '../hooks/useOnboardingForm'
import { db } from '../db/db'
import { getActiveAthleteId, isSelfScopeActive } from '../services/athlete/activeAthlete'
import { useAuthStore } from '../store/useAuthStore'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import type { SupportedSport, TrainingPriority } from '../types'
import type { OnboardingDayKey } from '../utils/schedule'
import { ONBOARDING_DAY_ORDER } from '../utils/schedule'
import { clearOnboardingSkipped, markOnboardingSkipped } from '../utils/onboarding'
import { buildOnboardingAthleteProfilePatch } from '../utils/onboardingProfilePatch'
import {
  formatStrengthConstraintFeedback,
  resolveStrengthSafetyConstraints,
} from '../services/training/strengthSafetyConstraints'

const SPORT_OPTIONS: Array<{ value: SupportedSport; label: string; emoji: string }> = [
  { value: 'squash', label: 'Squash', emoji: '🎾' },
  { value: 'running', label: 'Running', emoji: '🏃' },
  { value: 'strength', label: 'Pesas / fuerza', emoji: '🏋️' },
  { value: 'mobility', label: 'Movilidad', emoji: '🧘' },
  { value: 'cycling', label: 'Bicicleta', emoji: '🚴' },
]

const GOAL_OPTIONS: Array<{ value: TrainingPriority; label: string; description: string }> = [
  {
    value: 'performance',
    label: 'Competir mejor',
    description: 'Mejorar rendimiento y resultados en competencia.',
  },
  {
    value: 'fitness',
    label: 'Condición física',
    description: 'Mejorar salud, energía y estado general.',
  },
  {
    value: 'body_composition',
    label: 'Composición corporal',
    description: 'Bajar grasa, ganar músculo o recomponer.',
  },
  {
    value: 'return_to_play',
    label: 'Volver de lesión',
    description: 'Recuperación progresiva y segura al deporte.',
  },
]

const GOAL_MAIN_LABEL: Record<TrainingPriority, string> = {
  performance: 'Competir mejor',
  fitness: 'Mejorar condición física',
  body_composition: 'Composición corporal',
  return_to_play: 'Volver de una lesión',
}

const SPORT_LABELS: Record<SupportedSport, string> = {
  squash: 'squash',
  running: 'running',
  strength: 'fuerza',
  mobility: 'movilidad',
  cycling: 'ciclismo',
}

const DAYS: Array<{ key: OnboardingDayKey; label: string; shortLabel: string }> = [
  { key: 'lun', label: 'Lunes', shortLabel: 'L' },
  { key: 'mar', label: 'Martes', shortLabel: 'M' },
  { key: 'mié', label: 'Miércoles', shortLabel: 'Mi' },
  { key: 'jue', label: 'Jueves', shortLabel: 'J' },
  { key: 'vie', label: 'Viernes', shortLabel: 'V' },
  { key: 'sáb', label: 'Sábado', shortLabel: 'S' },
  { key: 'dom', label: 'Domingo', shortLabel: 'D' },
]

const TOTAL_STEPS = 5

const FIELD_STYLE = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
} as const

const TEXT_INPUT_CLASS = 'w-full rounded-xl px-4 py-3 text-sm text-ink placeholder:text-ink-faint outline-none transition-all'

export default function OnboardingPage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const activeAthleteId = useAuthStore((state) => state.activeAthleteId)
  const { athleteProfile, hasLoaded, isSaving, loadMemory, saveAthleteProfile } = useCoachMemoryStore()

  // /onboarding vive FUERA de AppShell → sin CoachContextBar ni remount por key:
  // mostrar aquí un chip con el atleta gestionado activo (spec 2b §6).
  const [managedAthleteName, setManagedAthleteName] = useState<string | null>(null)

  useEffect(() => {
    const active = getActiveAthleteId()
    let cancelled = false
    const resolveManagedName = async (): Promise<string | null> => {
      if (!active || isSelfScopeActive()) return null
      const row = await db.athletes.get(active)
      return row?.displayName ?? null
    }
    void resolveManagedName().then((name) => {
      if (!cancelled) setManagedAthleteName(name)
    })
    return () => { cancelled = true }
  }, [activeAthleteId])
  const {
    step,
    name,
    selectedSports,
    primarySport,
    priority,
    availableDays,
    doubleSessionDays,
    goalEventTitle,
    goalEventDate,
    goalEventNotes,
    availabilityNotes,
    currentInjuries,
    previousInjuries,
    restrictions,
    strengthNotes,
    squat1RM,
    deadlift1RM,
    benchPress1RM,
    overheadPress1RM,
    canGoNext,
    canFinish,
    setStep,
    setName,
    setPrimarySport,
    setPriority,
    toggleSport,
    toggleDay,
    replaceAvailableDays,
    toggleDoubleDay,
    setTextField,
  } = useOnboardingForm(athleteProfile, hasLoaded, isSaving)

  useEffect(() => {
    void loadMemory()
  }, [loadMemory])

  const primarySportOptions = useMemo(
    () => SPORT_OPTIONS.filter((option) => selectedSports.includes(option.value)),
    [selectedSports],
  )

  const strengthSafetyFeedback = useMemo(() => formatStrengthConstraintFeedback(
    resolveStrengthSafetyConstraints({
      currentInjuries,
      restrictions,
      userMessages: [],
      trainingPriority: priority ?? undefined,
    }),
  ), [currentInjuries, priority, restrictions])

  const summary = useMemo(() => {
    if (!primarySport || !priority) return []

    const items = [
      `Deportes: ${selectedSports.map((sport) => SPORT_LABELS[sport]).join(', ')}`,
      `Principal: ${SPORT_LABELS[primarySport]}`,
      `Objetivo: ${GOAL_MAIN_LABEL[priority]}`,
    ]

    if (goalEventTitle.trim() && goalEventDate.trim()) {
      items.push(`Evento: ${goalEventTitle.trim()} · ${goalEventDate.trim()}`)
    }
    if (
      availabilityNotes.trim() ||
      currentInjuries.trim() ||
      previousInjuries.trim() ||
      restrictions.trim() ||
      strengthNotes.trim() ||
      squat1RM.trim() ||
      deadlift1RM.trim() ||
      benchPress1RM.trim() ||
      overheadPress1RM.trim()
    ) {
      items.push('Contexto real: agregado')
    }

    return items
  }, [
    availabilityNotes,
    benchPress1RM,
    currentInjuries,
    deadlift1RM,
    goalEventDate,
    goalEventTitle,
    overheadPress1RM,
    primarySport,
    priority,
    previousInjuries,
    restrictions,
    selectedSports,
    squat1RM,
    strengthNotes,
  ])

  async function handleFinish() {
    if (!primarySport || !priority) return

    await saveAthleteProfile(buildOnboardingAthleteProfilePatch({
      existingProfile: athleteProfile,
      name,
      selectedSports,
      primarySport,
      priority,
      availableDays,
      doubleSessionDays,
      goalEventTitle,
      goalEventDate,
      goalEventNotes,
      availabilityNotes,
      currentInjuries,
      previousInjuries,
      restrictions,
      strengthNotes,
      squat1RM,
      deadlift1RM,
      benchPress1RM,
      overheadPress1RM,
    }), { source: 'post_reset_onboarding' })

    clearOnboardingSkipped(user?.id)
    navigate(ROUTES.HOME, { state: { showProfileNudge: true } })
  }

  async function handleSkip() {
    try {
      await saveAthleteProfile({ onboardingDeferredAt: Date.now() }, { source: 'post_reset_onboarding' })
    } catch (error) {
      console.error('[onboarding] failed to persist skip flag in athlete profile', error)
    }

    markOnboardingSkipped(user?.id)
    navigate(ROUTES.HOME)
  }

  const actions = (() => {
    if (step === 1) {
      return (
        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => setStep(2)}
          className="w-full rounded-xl py-3.5 font-display text-sm font-bold uppercase tracking-[0.18em] text-white transition-all active:scale-[0.98] disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #ff5500, #ff4d00)',
            boxShadow: canGoNext ? '0 8px 30px -8px rgba(255,77,0,0.55)' : 'none',
          }}
        >
          Continuar
        </button>
      )
    }

    if (step === 5) {
      return (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setStep(4)}
            className="flex-1 rounded-xl py-3.5 font-display text-sm font-bold uppercase tracking-[0.18em] text-ink-muted transition-all hover:text-ink"
            style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}
          >
            Atrás
          </button>
          <button
            type="button"
            disabled={!canFinish}
            onClick={() => void handleFinish()}
            className="flex flex-1 items-center justify-center rounded-xl py-3.5 font-display text-sm font-bold uppercase tracking-[0.18em] text-white transition-all active:scale-[0.98] disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, #ff5500, #ff4d00)',
              boxShadow: canFinish ? '0 8px 30px -8px rgba(255,77,0,0.55)' : 'none',
            }}
          >
            {isSaving ? (
              <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              'Comenzar'
            )}
          </button>
        </div>
      )
    }

    return (
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep((step - 1) as 1 | 2 | 3 | 4)}
          className="flex-1 rounded-xl py-3.5 font-display text-sm font-bold uppercase tracking-[0.18em] text-ink-muted transition-all hover:text-ink"
          style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}
        >
          Atrás
        </button>
        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => setStep((step + 1) as 2 | 3 | 4 | 5)}
          className="flex-1 rounded-xl py-3.5 font-display text-sm font-bold uppercase tracking-[0.18em] text-white transition-all active:scale-[0.98] disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #ff5500, #ff4d00)',
            boxShadow: canGoNext ? '0 8px 30px -8px rgba(255,77,0,0.55)' : 'none',
          }}
        >
          Continuar
        </button>
      </div>
    )
  })()

  return (
    <OnboardingStepFrame
      step={step}
      totalSteps={TOTAL_STEPS}
      title={
        step === 1
          ? (managedAthleteName ? `Perfil de ${managedAthleteName}` : 'Cuéntame quién eres')
          : step === 2
            ? '¿Cuál es tu disciplina principal?'
          : step === 3
            ? '¿Cuál es tu objetivo principal?'
            : step === 4
              ? '¿Cuándo puedes entrenar?'
              : 'Contexto deportivo real'
      }
      description={
        step === 1
          ? (managedAthleteName
              ? `Estás completando el perfil de ${managedAthleteName}. RallyIQ usará esta información para personalizar su plan.`
              : 'RallyIQ usará esta información para personalizar tus recomendaciones desde el primer día.')
          : step === 2
            ? 'Esto ayuda a priorizar mejor la planificación cuando entrenas más de un deporte.'
          : step === 3
            ? 'El foco principal cambia cómo priorizamos cargas, sesiones y recomendaciones.'
            : step === 4
              ? 'Selecciona los días disponibles y, si aplica, cuándo podrías hacer doble sesión.'
              : 'Agrega lo que un coach preguntaría antes de planificar: evento, disponibilidad real, molestias, historial, fuerza y acceso a cancha o partner.'
      }
      actions={actions}
      onSkip={() => {
        void handleSkip()
      }}
    >
      {step === 1 && (
        <>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ink-muted">Tu nombre o apodo</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ej. Rafa"
              className="w-full rounded-xl px-4 py-3 text-sm text-ink placeholder:text-ink-faint outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
              onFocus={(e) => {
                e.currentTarget.style.border = '1px solid rgba(255,77,0,0.35)'
                e.currentTarget.style.boxShadow = '0 3px 14px -3px rgba(255,77,0,0.35)'
              }}
              onBlur={(e) => {
                e.currentTarget.style.border = '1px solid rgba(255,255,255,0.1)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </label>

          <div>
            <p className="text-sm font-medium text-ink-muted">¿Qué disciplinas practicas?</p>
            <p className="mt-1 text-xs text-ink-faint">Selecciona todas las que entrenas regularmente.</p>
            <div className="mt-4 space-y-3">
              {SPORT_OPTIONS.map((option) => {
                const selected = selectedSports.includes(option.value)
                return (
                  <OnboardingChoiceButton
                    key={option.value}
                    label={option.label}
                    leading={option.emoji}
                    trailing={selected ? 'Seleccionado' : undefined}
                    selected={selected}
                    onClick={() => toggleSport(option.value)}
                  />
                )
              })}
            </div>
          </div>
        </>
      )}

      {step === 2 && (
        <div className="space-y-3">
          {primarySportOptions.map((option) => (
            <OnboardingChoiceButton
              key={option.value}
              label={option.label}
              leading={option.emoji}
              trailing={primarySport === option.value ? 'Principal' : undefined}
              selected={primarySport === option.value}
              onClick={() => setPrimarySport(option.value)}
            />
          ))}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          {GOAL_OPTIONS.map((option) => (
            <OnboardingChoiceButton
              key={option.value}
              label={option.label}
              description={option.description}
              selected={priority === option.value}
              onClick={() => setPriority(option.value)}
            />
          ))}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium text-ink-muted">Días disponibles</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => replaceAvailableDays(['lun', 'mar', 'mié', 'jue', 'vie'])}
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#a1a1aa' }}
              >
                L-V
              </button>
              <button
                type="button"
                onClick={() => replaceAvailableDays(['sáb', 'dom'])}
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#a1a1aa' }}
              >
                Fin de semana
              </button>
              <button
                type="button"
                onClick={() => replaceAvailableDays([...ONBOARDING_DAY_ORDER])}
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#a1a1aa' }}
              >
                Toda la semana
              </button>
              <button
                type="button"
                onClick={() => replaceAvailableDays([])}
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#a1a1aa' }}
              >
                Limpiar
              </button>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 xs:grid-cols-7">
              {DAYS.map((day) => {
                const selected = availableDays.includes(day.key)
                return (
                  <button
                    key={day.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleDay(day.key)}
                    className="rounded-full px-3 py-3 text-sm font-bold transition-all active:scale-95"
                    style={{
                      border: selected ? '1px solid rgba(255,77,0,0.5)' : '1px solid rgba(255,255,255,0.1)',
                      background: selected ? 'linear-gradient(135deg, #ff5500, #ff4d00)' : 'rgba(255,255,255,0.04)',
                      color: selected ? '#fff' : '#6e6e73',
                      boxShadow: selected ? '0 4px 16px -4px rgba(255,77,0,0.5)' : 'none',
                    }}
                    title={day.label}
                  >
                    {day.shortLabel}
                  </button>
                )
              })}
            </div>
            {availableDays.length > 0 && (
              <p className="mt-2 text-xs text-ink-muted">{availableDays.length} días seleccionados</p>
            )}
          </div>

          {availableDays.length > 0 && (
            <div>
              <p className="text-sm font-medium text-ink-muted">Días con opción de doble sesión</p>
              <p className="mt-1 text-xs text-ink-faint">Opcional. Solo te mostraremos estos días si ya están disponibles.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {DAYS.filter((day) => availableDays.includes(day.key)).map((day) => {
                  const selected = doubleSessionDays.includes(day.key)
                  return (
                    <button
                      key={day.key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleDoubleDay(day.key)}
                      className="rounded-full px-4 py-2 text-sm font-semibold transition-all"
                      style={{
                        border: selected ? '1px solid rgba(255,150,50,0.4)' : '1px solid rgba(255,255,255,0.1)',
                        background: selected ? 'rgba(255,140,50,0.14)' : 'rgba(255,255,255,0.04)',
                        color: selected ? '#ffab5e' : '#6e6e73',
                      }}
                    >
                      {day.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {summary.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-ink-faint">Resumen</p>
              <div className="mt-2 space-y-1 text-sm text-ink-muted">
                {summary.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 5 && (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-ink-muted">Próximo torneo o evento</span>
                <input
                  type="text"
                  value={goalEventTitle}
                  onChange={(event) => setTextField('goalEventTitle', event.target.value)}
                  placeholder="Ej. Nacional, 10K, liga del club"
                  className={TEXT_INPUT_CLASS}
                  style={FIELD_STYLE}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-ink-muted">Fecha</span>
                <input
                  type="date"
                  value={goalEventDate}
                  onChange={(event) => setTextField('goalEventDate', event.target.value)}
                  className={TEXT_INPUT_CLASS}
                  style={{ ...FIELD_STYLE, colorScheme: 'dark' }}
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-ink-muted">Notas del evento</span>
              <textarea
                value={goalEventNotes}
                onChange={(event) => setTextField('goalEventNotes', event.target.value)}
                placeholder="Formato, rondas, distancia, objetivo o cualquier detalle competitivo."
                className={`${TEXT_INPUT_CLASS} min-h-[84px] resize-none`}
                style={FIELD_STYLE}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ink-muted">Disponibilidad real, cancha y partner</span>
            <textarea
              value={availabilityNotes}
              onChange={(event) => setTextField('availabilityNotes', event.target.value)}
              placeholder="Ej. martes solo 45 min, jueves con partner, cancha disponible sábados AM."
              className={`${TEXT_INPUT_CLASS} min-h-[96px] resize-none`}
              style={FIELD_STYLE}
            />
          </label>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-ink-muted">Molestias actuales</span>
              <textarea
                value={currentInjuries}
                onChange={(event) => setTextField('currentInjuries', event.target.value)}
                placeholder="Dolor, zonas sensibles o molestias recientes."
                className={`${TEXT_INPUT_CLASS} min-h-[92px] resize-none`}
                style={FIELD_STYLE}
              />
              {strengthSafetyFeedback && (
                <p className="mt-1.5 text-xs text-ink-faint">{strengthSafetyFeedback}</p>
              )}
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-ink-muted">Historial</span>
              <textarea
                value={previousInjuries}
                onChange={(event) => setTextField('previousInjuries', event.target.value)}
                placeholder="Lesiones previas o recaídas importantes."
                className={`${TEXT_INPUT_CLASS} min-h-[92px] resize-none`}
                style={FIELD_STYLE}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-ink-muted">Restricciones</span>
              <textarea
                value={restrictions}
                onChange={(event) => setTextField('restrictions', event.target.value)}
                placeholder="Movimientos a evitar, indicaciones médicas o límites de impacto."
                className={`${TEXT_INPUT_CLASS} min-h-[92px] resize-none`}
                style={FIELD_STYLE}
              />
            </label>
          </div>

          <div>
            <p className="text-sm font-medium text-ink-muted">Fuerza / 1RM estimado</p>
            <p className="mt-1 text-xs text-ink-faint">Opcional. Usa kg si tienes referencias reales o estimadas.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-ink-faint">Sentadilla</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={squat1RM}
                  onChange={(event) => setTextField('squat1RM', event.target.value)}
                  placeholder="kg"
                  className={TEXT_INPUT_CLASS}
                  style={FIELD_STYLE}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-ink-faint">Peso muerto</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deadlift1RM}
                  onChange={(event) => setTextField('deadlift1RM', event.target.value)}
                  placeholder="kg"
                  className={TEXT_INPUT_CLASS}
                  style={FIELD_STYLE}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-ink-faint">Press banca</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={benchPress1RM}
                  onChange={(event) => setTextField('benchPress1RM', event.target.value)}
                  placeholder="kg"
                  className={TEXT_INPUT_CLASS}
                  style={FIELD_STYLE}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-ink-faint">Press hombro</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={overheadPress1RM}
                  onChange={(event) => setTextField('overheadPress1RM', event.target.value)}
                  placeholder="kg"
                  className={TEXT_INPUT_CLASS}
                  style={FIELD_STYLE}
                />
              </label>
            </div>
            <label className="mt-3 block">
              <span className="mb-2 block text-sm font-medium text-ink-muted">Notas de fuerza</span>
              <textarea
                value={strengthNotes}
                onChange={(event) => setTextField('strengthNotes', event.target.value)}
                placeholder="Equipamiento, ejercicios dominantes, límites técnicos o cargas recientes."
                className={`${TEXT_INPUT_CLASS} min-h-[84px] resize-none`}
                style={FIELD_STYLE}
              />
            </label>
          </div>
        </div>
      )}
    </OnboardingStepFrame>
  )
}
