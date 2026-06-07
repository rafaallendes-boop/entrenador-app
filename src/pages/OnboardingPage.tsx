import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import OnboardingChoiceButton from '../components/onboarding/OnboardingChoiceButton'
import OnboardingStepFrame from '../components/onboarding/OnboardingStepFrame'
import { ROUTES } from '../constants/routes'
import { useOnboardingForm } from '../hooks/useOnboardingForm'
import { useAuthStore } from '../store/useAuthStore'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import type { SupportedSport, TrainingPriority } from '../types'
import type { OnboardingDayKey } from '../utils/schedule'
import { ONBOARDING_DAY_ORDER } from '../utils/schedule'
import { clearOnboardingSkipped, markOnboardingSkipped } from '../utils/onboarding'

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

const TOTAL_STEPS = 4

export default function OnboardingPage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const { athleteProfile, hasLoaded, isSaving, loadMemory, saveAthleteProfile } = useCoachMemoryStore()
  const {
    step,
    name,
    selectedSports,
    primarySport,
    priority,
    availableDays,
    doubleSessionDays,
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
  } = useOnboardingForm(athleteProfile, hasLoaded, isSaving)

  useEffect(() => {
    void loadMemory()
  }, [loadMemory])

  const primarySportOptions = useMemo(
    () => SPORT_OPTIONS.filter((option) => selectedSports.includes(option.value)),
    [selectedSports],
  )

  const summary = useMemo(() => {
    if (!primarySport || !priority) return []

    return [
      `Deportes: ${selectedSports.map((sport) => SPORT_LABELS[sport]).join(', ')}`,
      `Principal: ${SPORT_LABELS[primarySport]}`,
      `Objetivo: ${GOAL_MAIN_LABEL[priority]}`,
    ]
  }, [primarySport, priority, selectedSports])

  async function handleFinish() {
    if (!primarySport || !priority) return

    await saveAthleteProfile({
      name: name.trim() || undefined,
      onboardingDeferredAt: undefined,
      sportContext: {
        enabledSports: selectedSports,
        primarySport,
        secondarySports: selectedSports.filter((sport) => sport !== primarySport),
        trainingPriority: priority,
      },
      mainGoal: GOAL_MAIN_LABEL[priority],
      scheduleProfile: {
        availableDays,
        doubleSessionDays: doubleSessionDays.length > 0 ? doubleSessionDays : undefined,
      },
    }, { source: 'post_reset_onboarding' })

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

    if (step === 4) {
      return (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setStep(3)}
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
          onClick={() => setStep((step - 1) as 1 | 2 | 3)}
          className="flex-1 rounded-xl py-3.5 font-display text-sm font-bold uppercase tracking-[0.18em] text-ink-muted transition-all hover:text-ink"
          style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}
        >
          Atrás
        </button>
        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => setStep((step + 1) as 2 | 3 | 4)}
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
          ? 'Cuéntame quién eres'
          : step === 2
            ? '¿Cuál es tu disciplina principal?'
            : step === 3
              ? '¿Cuál es tu objetivo principal?'
              : '¿Cuándo puedes entrenar?'
      }
      description={
        step === 1
          ? 'RallyIQ usará esta información para personalizar tus recomendaciones desde el primer día.'
          : step === 2
            ? 'Esto ayuda a priorizar mejor la planificación cuando entrenas más de un deporte.'
            : step === 3
              ? 'El foco principal cambia cómo priorizamos cargas, sesiones y recomendaciones.'
              : 'Selecciona los días disponibles y, si aplica, cuándo podrías hacer doble sesión.'
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
    </OnboardingStepFrame>
  )
}
