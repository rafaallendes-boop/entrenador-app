import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SupportedSport, TrainingPriority } from '../types'
import { ROUTES } from '../constants/routes'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { useAuthStore } from '../store/useAuthStore'
import { clearOnboardingSkipped, markOnboardingSkipped } from '../utils/onboarding'

const SPORT_OPTIONS: { value: SupportedSport; label: string; emoji: string }[] = [
  { value: 'squash', label: 'Squash', emoji: '🎾' },
  { value: 'running', label: 'Running', emoji: '🏃' },
  { value: 'strength', label: 'Pesas / Fuerza', emoji: '🏋️' },
  { value: 'mobility', label: 'Movilidad', emoji: '🧘' },
  { value: 'cycling', label: 'Bicicleta', emoji: '🚴' },
]

const GOAL_OPTIONS: { value: TrainingPriority; label: string; description: string }[] = [
  {
    value: 'performance',
    label: 'Competir mejor',
    description: 'Mejorar rendimiento y resultados en competencia',
  },
  {
    value: 'fitness',
    label: 'Condición física',
    description: 'Mejorar salud, energía y estado general',
  },
  {
    value: 'body_composition',
    label: 'Composición corporal',
    description: 'Bajar grasa, ganar músculo o recomposición',
  },
  {
    value: 'return_to_play',
    label: 'Volver de lesión',
    description: 'Recuperación progresiva al deporte',
  },
]

const GOAL_MAIN_LABEL: Record<TrainingPriority, string> = {
  performance: 'Competir mejor',
  fitness: 'Mejorar condición física',
  body_composition: 'Composición corporal',
  return_to_play: 'Volver de una lesión',
}

const SPORT_ES: Record<SupportedSport, string> = {
  squash: 'squash',
  running: 'running',
  strength: 'fuerza',
  mobility: 'movilidad',
  cycling: 'ciclismo',
}

const DAYS = [
  { key: 'lun', label: 'L' },
  { key: 'mar', label: 'M' },
  { key: 'mié', label: 'Mi' },
  { key: 'jue', label: 'J' },
  { key: 'vie', label: 'V' },
  { key: 'sáb', label: 'S' },
  { key: 'dom', label: 'D' },
]

const TOTAL_STEPS = 4

export default function OnboardingPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { saveAthleteProfile, isSaving, loadMemory } = useCoachMemoryStore()

  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [selectedSports, setSelectedSports] = useState<SupportedSport[]>([])
  const [primarySport, setPrimarySport] = useState<SupportedSport | null>(null)
  const [priority, setPriority] = useState<TrainingPriority | null>(null)
  const [availableDays, setAvailableDays] = useState<string[]>([])
  const [doubleSessionDays, setDoubleSessionDays] = useState<string[]>([])

  useEffect(() => {
    void loadMemory()
  }, [loadMemory])

  function toggleSport(sport: SupportedSport) {
    setSelectedSports((prev) => {
      const next = prev.includes(sport) ? prev.filter((item) => item !== sport) : [...prev, sport]
      if (primarySport && !next.includes(primarySport)) {
        setPrimarySport(null)
      }
      return next
    })
  }

  function toggleDay(day: string) {
    setAvailableDays((prev) => (prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day]))
  }

  function toggleDoubleDay(day: string) {
    setDoubleSessionDays((prev) => (prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day]))
  }

  async function handleFinish() {
    if (!primarySport || !priority) return

    await saveAthleteProfile({
      name: name.trim() || undefined,
      sportContext: {
        enabledSports: selectedSports,
        primarySport,
        secondarySports: selectedSports.filter((sport) => sport !== primarySport),
        trainingPriority: priority,
      },
      mainGoal: GOAL_MAIN_LABEL[priority],
      scheduleProfile: {
        availableDays: availableDays.length > 0 ? availableDays : undefined,
        doubleSessionDays: doubleSessionDays.length > 0 ? doubleSessionDays : undefined,
      },
    })

    clearOnboardingSkipped(user?.id)
    navigate(ROUTES.HOME, { state: { showProfileNudge: true } })
  }

  function handleSkip() {
    markOnboardingSkipped(user?.id)
    navigate(ROUTES.HOME)
  }

  const canNext1 = selectedSports.length > 0
  const canNext2 = primarySport !== null
  const canNext3 = priority !== null
  const canFinish = availableDays.length > 0 && !isSaving

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={handleSkip}
            className="text-sm font-medium text-ink-faint transition-colors hover:text-ink-muted"
          >
            Omitir por ahora
          </button>
        </div>

        <div className="mb-8">
          <div className="mb-2 flex justify-between">
            <span className="text-xs text-ink-muted">Paso {step} de {TOTAL_STEPS}</span>
            <span className="text-xs text-ink-muted">{Math.round((step / TOTAL_STEPS) * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-border">
            <div
              className="h-full rounded-full bg-brand transition-all duration-300"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>

        {step === 1 && (
          <div>
            <h1 className="mb-1 text-2xl font-bold text-ink">¡Hola! ¿Cómo te llamas?</h1>
            <p className="mb-4 text-sm text-ink-muted">El coach usará este nombre para dirigirse a ti.</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre o apodo"
              className="mb-6 w-full rounded-xl border-2 border-surface-border bg-surface-card px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
            />
            <p className="mb-3 text-sm font-medium text-ink-muted">¿Qué disciplinas practicas?</p>
            <p className="mb-4 text-xs text-ink-faint">Selecciona todas las que entrenas regularmente.</p>
            <div className="space-y-3">
              {SPORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleSport(option.value)}
                  className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                    selectedSports.includes(option.value)
                      ? 'border-brand bg-brand/10 text-ink'
                      : 'border-surface-border bg-surface-card text-ink-muted hover:border-brand/50'
                  }`}
                >
                  <span className="text-xl">{option.emoji}</span>
                  <span className="font-medium">{option.label}</span>
                  {selectedSports.includes(option.value) && <span className="ml-auto text-brand">✓</span>}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!canNext1}
              onClick={() => setStep(2)}
              className="mt-6 w-full rounded-xl bg-brand py-3 font-semibold text-white transition-opacity disabled:opacity-40"
            >
              Continuar
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h1 className="mb-1 text-2xl font-bold text-ink">¿Cuál es tu disciplina principal?</h1>
            <p className="mb-6 text-sm text-ink-muted">
              El coach priorizará esta disciplina en tu planificación.
            </p>
            <div className="space-y-3">
              {SPORT_OPTIONS.filter((option) => selectedSports.includes(option.value)).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPrimarySport(option.value)}
                  className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                    primarySport === option.value
                      ? 'border-brand bg-brand/10 text-ink'
                      : 'border-surface-border bg-surface-card text-ink-muted hover:border-brand/50'
                  }`}
                >
                  <span className="text-xl">{option.emoji}</span>
                  <span className="font-medium">{option.label}</span>
                  {primarySport === option.value && <span className="ml-auto text-brand">✓</span>}
                </button>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 rounded-xl border-2 border-surface-border py-3 font-semibold text-ink-muted"
              >
                Atrás
              </button>
              <button
                type="button"
                disabled={!canNext2}
                onClick={() => setStep(3)}
                className="flex-1 rounded-xl bg-brand py-3 font-semibold text-white transition-opacity disabled:opacity-40"
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h1 className="mb-1 text-2xl font-bold text-ink">¿Cuál es tu objetivo principal?</h1>
            <p className="mb-6 text-sm text-ink-muted">El coach ajustará sus recomendaciones a este foco.</p>
            <div className="space-y-3">
              {GOAL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPriority(option.value)}
                  className={`w-full rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                    priority === option.value
                      ? 'border-brand bg-brand/10'
                      : 'border-surface-border bg-surface-card hover:border-brand/50'
                  }`}
                >
                  <p className={`font-medium ${priority === option.value ? 'text-ink' : 'text-ink-muted'}`}>
                    {option.label}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-faint">{option.description}</p>
                </button>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex-1 rounded-xl border-2 border-surface-border py-3 font-semibold text-ink-muted"
              >
                Atrás
              </button>
              <button
                type="button"
                disabled={!canNext3}
                onClick={() => setStep(4)}
                className="flex-1 rounded-xl bg-brand py-3 font-semibold text-white transition-opacity disabled:opacity-40"
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h1 className="mb-1 text-2xl font-bold text-ink">¿Cuándo puedes entrenar?</h1>
            <p className="mb-6 text-sm text-ink-muted">Selecciona los días que tienes disponibles.</p>

            <div className="mb-6">
              <p className="mb-3 text-sm font-medium text-ink-muted">Días disponibles</p>
              <div className="flex justify-between gap-2">
                {DAYS.map((day) => (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => toggleDay(day.key)}
                    className={`h-10 w-10 rounded-full text-sm font-semibold transition-colors ${
                      availableDays.includes(day.key)
                        ? 'bg-brand text-white'
                        : 'border border-surface-border bg-surface-card text-ink-muted'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              {availableDays.length > 0 && (
                <p className="mt-2 text-xs text-ink-muted">{availableDays.length} días seleccionados</p>
              )}
            </div>

            {availableDays.length > 0 && (
              <div className="mb-6">
                <p className="mb-1 text-sm font-medium text-ink-muted">¿Algún día puedes hacer doble sesión?</p>
                <p className="mb-3 text-xs text-ink-faint">Opcional</p>
                <div className="flex justify-between gap-2">
                  {DAYS.filter((day) => availableDays.includes(day.key)).map((day) => (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => toggleDoubleDay(day.key)}
                      className={`h-10 w-10 rounded-full text-sm font-semibold transition-colors ${
                        doubleSessionDays.includes(day.key)
                          ? 'bg-amber-500 text-white'
                          : 'border border-surface-border bg-surface-card text-ink-muted'
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {primarySport && priority && (
              <div className="mb-6 space-y-1 rounded-xl border border-surface-border bg-surface-card p-4 text-sm text-ink-muted">
                <p>
                  <span className="font-medium text-ink">Deportes:</span> {selectedSports.map((sport) => SPORT_ES[sport]).join(', ')}
                </p>
                <p>
                  <span className="font-medium text-ink">Principal:</span> {SPORT_ES[primarySport]}
                </p>
                <p>
                  <span className="font-medium text-ink">Objetivo:</span> {GOAL_MAIN_LABEL[priority]}
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="flex-1 rounded-xl border-2 border-surface-border py-3 font-semibold text-ink-muted"
              >
                Atrás
              </button>
              <button
                type="button"
                disabled={!canFinish}
                onClick={() => void handleFinish()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-3 font-semibold text-white transition-opacity disabled:opacity-40"
              >
                {isSaving ? (
                  <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                ) : (
                  'Comenzar'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
