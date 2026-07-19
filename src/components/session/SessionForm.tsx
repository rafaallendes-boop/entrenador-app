import { useRef, useState, type FormEvent } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { SESSION_TYPE_CONFIG } from '../../constants/sessionTypes'
import type {
  MatchResult,
  RunningType,
  SessionType,
  SquashSubtype,
  TimeBlock,
} from '../../types'
import type { CoachSessionDraft } from '../../services/athlete/coachSessionSerializer'
import { todayISO } from '../../utils/date'
import { v4 as uuid } from '../../utils/uuid'

export interface SessionFormProps {
  initialValues?: CoachSessionDraft
  defaultSport: SessionType
  defaultDate?: string
  heading: string
  submitLabel: string
  mode?: 'session' | 'template'
  initialName?: string
  onSubmit: (values: CoachSessionDraft, meta?: { templateName: string }) => Promise<void>
  onCancel: () => void
}

interface ExerciseDraft {
  id: string
  name: string
  sets: string
  reps: string
  weight: string
  notes: string
}

const SESSION_TYPES: SessionType[] = ['squash', 'running', 'cycling', 'strength', 'mobility', 'recovery']
const RUNNING_TYPES: Array<{ value: RunningType; label: string }> = [
  { value: 'z2', label: 'Z2 Aerobico' },
  { value: 'tempo', label: 'Tempo' },
  { value: 'intervals', label: 'Intervalos' },
  { value: 'long', label: 'Long Run' },
]
const SQUASH_SUBTYPES: Array<{ value: SquashSubtype; label: string }> = [
  { value: 'training', label: 'Entrenamiento' },
  { value: 'match', label: 'Partido' },
  { value: 'competitive', label: 'Competitivo' },
  { value: 'control', label: 'Control' },
  { value: 'light', label: 'Suave' },
]
const MATCH_RESULTS: Array<{ value: MatchResult; label: string }> = [
  { value: 'win', label: 'Gane' },
  { value: 'loss', label: 'Perdi' },
]
const TYPE_LABELS: Record<SessionType, string> = {
  squash: 'Sesion de squash',
  running: 'Salida de running',
  cycling: 'Sesion de ciclismo',
  strength: 'Sesion de fuerza',
  mobility: 'Movilidad',
  recovery: 'Recuperacion activa',
  nutrition: 'Nutricion',
}

const emptyExercise = (): ExerciseDraft => ({
  id: uuid(), name: '', sets: '3', reps: '10', weight: '', notes: '',
})
const optionalNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export default function SessionForm({
  initialValues,
  defaultSport,
  defaultDate,
  heading,
  submitLabel,
  mode = 'session',
  initialName,
  onSubmit,
  onCancel,
}: SessionFormProps) {
  const initialType = initialValues?.type ?? defaultSport
  const isTemplate = mode === 'template'
  const [type, setType] = useState<SessionType>(initialType)
  const [title, setTitle] = useState(initialValues?.title ?? TYPE_LABELS[initialType])
  const [templateName, setTemplateName] = useState(
    initialName ?? initialValues?.title ?? TYPE_LABELS[initialType],
  )
  const [nameTouched, setNameTouched] = useState(initialName != null)
  const [date, setDate] = useState(initialValues?.date ?? defaultDate ?? todayISO())
  const [timeBlock, setTimeBlock] = useState<TimeBlock>(initialValues?.timeBlock ?? 'AM')
  const [duration, setDuration] = useState(initialValues?.durationMin ?? 60)
  const [rpe, setRpe] = useState<number | ''>(initialValues?.rpe ?? '')
  const [objective, setObjective] = useState(initialValues?.objective ?? '')
  const [notes, setNotes] = useState(initialValues?.notes ?? '')
  const [location, setLocation] = useState(initialValues?.location ?? '')
  const [runningType, setRunningType] = useState<RunningType>(
    initialValues?.runningTargets?.runningType ?? 'z2',
  )
  const [paceMin, setPaceMin] = useState(initialValues?.runningTargets?.targetPaceMin ?? '')
  const [paceMax, setPaceMax] = useState(initialValues?.runningTargets?.targetPaceMax ?? '')
  const [hrMin, setHrMin] = useState(String(initialValues?.runningTargets?.targetHrMin ?? ''))
  const [hrMax, setHrMax] = useState(String(initialValues?.runningTargets?.targetHrMax ?? ''))
  const [squashSubtype, setSquashSubtype] = useState<SquashSubtype>(initialValues?.subtype ?? 'training')
  const [opponent, setOpponent] = useState(initialValues?.opponent ?? '')
  const [matchResult, setMatchResult] = useState<MatchResult | ''>(initialValues?.matchResult ?? '')
  const [gamesWon, setGamesWon] = useState(String(initialValues?.gamesWon ?? ''))
  const [gamesLost, setGamesLost] = useState(String(initialValues?.gamesLost ?? ''))
  const [exercises, setExercises] = useState<ExerciseDraft[]>(() => (
    initialValues?.exercises?.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      sets: String(exercise.sets),
      reps: exercise.reps,
      weight: String(exercise.weight ?? ''),
      notes: exercise.notes ?? '',
    })) ?? []
  ))
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const showExercises = type === 'strength' || type === 'mobility'
  const showRunningFields = type === 'running' || type === 'cycling'
  const isSquashMatch = !isTemplate && type === 'squash' && (squashSubtype === 'match' || squashSubtype === 'competitive')
  const showLocation = type === 'squash' || type === 'running' || type === 'cycling'
  const config = SESSION_TYPE_CONFIG[type]

  const handleTypeChange = (nextType: SessionType) => {
    const previousDefaultTitle = TYPE_LABELS[type]
    const nextTitle = title === previousDefaultTitle ? TYPE_LABELS[nextType] : title
    setType(nextType)
    setTitle(nextTitle)
    if (isTemplate && !nameTouched) setTemplateName(nextTitle)
    if (nextType !== 'strength' && nextType !== 'mobility') setExercises([])
    if (nextType !== 'running' && nextType !== 'cycling') {
      setRunningType('z2')
      setPaceMin('')
      setPaceMax('')
      setHrMin('')
      setHrMax('')
    }
    if (nextType !== 'squash') {
      setSquashSubtype('training')
      setOpponent('')
      setMatchResult('')
      setGamesWon('')
      setGamesLost('')
    }
    if (!['squash', 'running', 'cycling'].includes(nextType)) setLocation('')
  }

  const handleTitleChange = (nextTitle: string) => {
    setTitle(nextTitle)
    if (isTemplate && !nameTouched) setTemplateName(nextTitle)
  }

  const handleSquashSubtypeChange = (nextSubtype: SquashSubtype) => {
    setSquashSubtype(nextSubtype)
    if (nextSubtype !== 'match' && nextSubtype !== 'competitive') {
      setOpponent('')
      setMatchResult('')
      setGamesWon('')
      setGamesLost('')
    }
  }

  const updateExercise = (id: string, field: keyof ExerciseDraft, value: string) => {
    setExercises((current) => current.map((exercise) => (
      exercise.id === id ? { ...exercise, [field]: value } : exercise
    )))
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || submittingRef.current) return
    const values: CoachSessionDraft = {
      date,
      timeBlock,
      type,
      title: title.trim(),
      durationMin: duration,
      objective: objective.trim() || undefined,
      location: showLocation ? location.trim() || undefined : undefined,
      rpe: rpe === '' ? undefined : rpe,
      notes: notes.trim() || undefined,
      subtype: type === 'squash' ? squashSubtype : undefined,
      opponent: isSquashMatch ? opponent.trim() || undefined : undefined,
      matchResult: isSquashMatch && matchResult ? matchResult : undefined,
      gamesWon: isSquashMatch ? optionalNumber(gamesWon) : undefined,
      gamesLost: isSquashMatch ? optionalNumber(gamesLost) : undefined,
      runningTargets: showRunningFields
        ? {
            runningType,
            targetPaceMin: paceMin.trim() || undefined,
            targetPaceMax: paceMax.trim() || undefined,
            targetHrMin: optionalNumber(hrMin),
            targetHrMax: optionalNumber(hrMax),
          }
        : undefined,
      exercises: showExercises
        ? exercises
            .filter((exercise) => exercise.name.trim())
            .map((exercise) => ({
              id: exercise.id,
              name: exercise.name.trim(),
              sets: Number(exercise.sets) || 3,
              reps: exercise.reps.trim() || '10',
              weight: optionalNumber(exercise.weight),
              notes: exercise.notes.trim() || undefined,
            }))
        : undefined,
    }

    submittingRef.current = true
    setIsSubmitting(true)
    setError(null)
    try {
      await onSubmit(values, isTemplate ? { templateName: templateName.trim() } : undefined)
    } catch (submitError) {
      setError(submitError instanceof Error
        ? submitError.message
        : isTemplate ? 'No se pudo guardar la plantilla.' : 'No se pudo guardar la sesión.')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex justify-center pb-1 pt-3 md:hidden">
        <div className="h-1 w-10 rounded-full bg-surface-border" />
      </div>
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-3 md:px-6">
        <h2 className="text-base font-semibold text-ink">{heading}</h2>
        <button
          type="button"
          aria-label="Cerrar"
          disabled={isSubmitting}
          onClick={onCancel}
          className="rounded-lg p-1 text-ink-muted hover:text-ink disabled:opacity-40"
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-5 px-4 py-4 pb-8 md:px-6">
        <fieldset disabled={isSubmitting} className="contents">
          <div>
            <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Tipo</span>
            <div className="flex flex-wrap gap-2">
              {SESSION_TYPES.map((sessionType) => {
                const typeConfig = SESSION_TYPE_CONFIG[sessionType]
                return (
                  <button
                    type="button"
                    key={sessionType}
                    onClick={() => handleTypeChange(sessionType)}
                    aria-pressed={type === sessionType}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                      type === sessionType
                        ? `${typeConfig.bgClass} ${typeConfig.textClass} ${typeConfig.borderClass}`
                        : 'border-surface-border bg-surface-raised text-ink-muted'
                    }`}
                  >
                    {typeConfig.label}
                  </button>
                )
              })}
            </div>
          </div>

          {type === 'squash' && (
            <div>
              <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Subtipo</span>
              <div className="flex flex-wrap gap-2">
                {SQUASH_SUBTYPES.map((subtype) => (
                  <button
                    type="button"
                    key={subtype.value}
                    onClick={() => handleSquashSubtypeChange(subtype.value)}
                    aria-pressed={squashSubtype === subtype.value}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                      squashSubtype === subtype.value
                        ? `${config.bgClass} ${config.textClass} ${config.borderClass}`
                        : 'border-surface-border bg-surface-raised text-ink-muted'
                    }`}
                  >{subtype.label}</button>
                ))}
              </div>
            </div>
          )}

          {showRunningFields && (
            <div>
              <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">
                {type === 'cycling' ? 'Tipo de sesión' : 'Tipo de carrera'}
              </span>
              <div className="flex flex-wrap gap-2">
                {RUNNING_TYPES.map((run) => (
                  <button
                    type="button"
                    key={run.value}
                    onClick={() => setRunningType(run.value)}
                    aria-pressed={runningType === run.value}
                    className="rounded-full border border-surface-border px-3 py-1.5 text-xs font-medium"
                  >{run.label}</button>
                ))}
              </div>
            </div>
          )}

          {isTemplate && (
            <label className="block text-xs font-medium uppercase tracking-wider text-ink-muted">
              Nombre de plantilla
              <input
                aria-label="Nombre de plantilla"
                type="text"
                value={templateName}
                onChange={(event) => {
                  setNameTouched(true)
                  setTemplateName(event.target.value)
                }}
                placeholder="Nombre para la Biblioteca"
                className="mt-2 w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm normal-case text-ink"
              />
            </label>
          )}

          <label className="block text-xs font-medium uppercase tracking-wider text-ink-muted">
            Titulo
            <input
              aria-label="Titulo"
              type="text"
              value={title}
              onChange={(event) => handleTitleChange(event.target.value)}
              placeholder="Nombre de la sesion"
              className="mt-2 w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm normal-case text-ink"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            {!isTemplate && (
              <label className="block text-xs font-medium uppercase tracking-wider text-ink-muted">
                Fecha
                <input aria-label="Fecha" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-2 w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink" />
              </label>
            )}
            <div>
              <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Bloque</span>
              <div className="flex overflow-hidden rounded-xl border border-surface-border">
                {(['AM', 'PM'] as TimeBlock[]).map((block) => (
                  <button type="button" key={block} onClick={() => setTimeBlock(block)} aria-pressed={timeBlock === block} className={`px-4 py-2.5 text-sm ${timeBlock === block ? 'bg-brand text-white' : 'bg-surface-raised text-ink-muted'}`}>{block}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium uppercase tracking-wider text-ink-muted">
              Duracion (min)
              <input aria-label="Duracion (min)" type="number" min={5} max={300} step={5} value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink" />
            </label>
            <label className="block text-xs font-medium uppercase tracking-wider text-ink-muted">
              RPE planificado
              <input aria-label="RPE planificado" type="number" min={1} max={10} value={rpe} onChange={(event) => setRpe(event.target.value === '' ? '' : Number(event.target.value))} className="mt-2 w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink" />
            </label>
          </div>

          {showLocation && (
            <label className="block text-xs font-medium uppercase tracking-wider text-ink-muted">
              Lugar o club
              <input aria-label="Lugar o club" type="text" value={location} onChange={(event) => setLocation(event.target.value)} className="mt-2 w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink" />
            </label>
          )}

          {isSquashMatch && (
            <div className="space-y-3 rounded-2xl border border-surface-border bg-surface-raised/60 p-3">
              <label className="block text-xs font-medium uppercase tracking-wider text-ink-muted">Rival<input aria-label="Rival" type="text" value={opponent} onChange={(event) => setOpponent(event.target.value)} className="mt-2 w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-ink" /></label>
              <div className="flex gap-2">
                {MATCH_RESULTS.map((result) => <button type="button" key={result.value} aria-pressed={matchResult === result.value} onClick={() => setMatchResult((current) => current === result.value ? '' : result.value)} className="rounded-full border px-3 py-1.5 text-xs">{result.label}</button>)}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs uppercase text-ink-muted">Games ganados<input aria-label="Games ganados" type="number" min={0} max={5} value={gamesWon} onChange={(event) => setGamesWon(event.target.value)} className="mt-2 w-full rounded-xl border bg-surface px-3 py-2" /></label>
                <label className="text-xs uppercase text-ink-muted">Games perdidos<input aria-label="Games perdidos" type="number" min={0} max={5} value={gamesLost} onChange={(event) => setGamesLost(event.target.value)} className="mt-2 w-full rounded-xl border bg-surface px-3 py-2" /></label>
              </div>
            </div>
          )}

          {showRunningFields && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs uppercase text-ink-muted">Ritmo min (min/km)<input aria-label="Ritmo min (min/km)" value={paceMin} onChange={(event) => setPaceMin(event.target.value)} className="mt-2 w-full rounded-xl border bg-surface-raised px-3 py-2" /></label>
              <label className="text-xs uppercase text-ink-muted">Ritmo max (min/km)<input aria-label="Ritmo max (min/km)" value={paceMax} onChange={(event) => setPaceMax(event.target.value)} className="mt-2 w-full rounded-xl border bg-surface-raised px-3 py-2" /></label>
              <label className="text-xs uppercase text-ink-muted">FC min (bpm)<input aria-label="FC min (bpm)" type="number" value={hrMin} onChange={(event) => setHrMin(event.target.value)} className="mt-2 w-full rounded-xl border bg-surface-raised px-3 py-2" /></label>
              <label className="text-xs uppercase text-ink-muted">FC max (bpm)<input aria-label="FC max (bpm)" type="number" value={hrMax} onChange={(event) => setHrMax(event.target.value)} className="mt-2 w-full rounded-xl border bg-surface-raised px-3 py-2" /></label>
            </div>
          )}

          {showExercises && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase text-ink-muted">{type === 'mobility' ? 'Ejercicios de movilidad' : 'Ejercicios'}</span>
                <button type="button" onClick={() => setExercises((current) => [...current, emptyExercise()])} className="flex items-center gap-1 text-xs text-brand-light"><Plus size={12} /> Añadir</button>
              </div>
              <div className="space-y-3">
                {exercises.map((exercise, index) => (
                  <div key={exercise.id} className="space-y-2 rounded-xl bg-surface-raised p-3">
                    <div className="flex gap-2">
                      <input aria-label={`Ejercicio ${index + 1}`} value={exercise.name} onChange={(event) => updateExercise(exercise.id, 'name', event.target.value)} className="flex-1 rounded-lg border bg-surface px-2.5 py-1.5" />
                      <button type="button" aria-label={`Eliminar ejercicio ${index + 1}`} onClick={() => setExercises((current) => current.filter((item) => item.id !== exercise.id))}><Trash2 size={14} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <input aria-label={`Series ${index + 1}`} type="number" value={exercise.sets} onChange={(event) => updateExercise(exercise.id, 'sets', event.target.value)} className="rounded-lg border bg-surface px-2 py-1.5" />
                      <input aria-label={`Reps ${index + 1}`} value={exercise.reps} onChange={(event) => updateExercise(exercise.id, 'reps', event.target.value)} className="rounded-lg border bg-surface px-2 py-1.5" />
                      {type === 'strength' && <input aria-label={`Carga ${index + 1}`} type="number" value={exercise.weight} onChange={(event) => updateExercise(exercise.id, 'weight', event.target.value)} className="rounded-lg border bg-surface px-2 py-1.5" />}
                    </div>
                    <input aria-label={`Notas ejercicio ${index + 1}`} value={exercise.notes} onChange={(event) => updateExercise(exercise.id, 'notes', event.target.value)} className="w-full rounded-lg border bg-surface px-2.5 py-1.5" />
                  </div>
                ))}
                {exercises.length === 0 && <button type="button" onClick={() => setExercises([emptyExercise()])} className="w-full rounded-xl border border-dashed py-3 text-xs text-ink-faint">+ Añadir ejercicio</button>}
              </div>
            </div>
          )}

          <label className="block text-xs font-medium uppercase tracking-wider text-ink-muted">Objetivo<input aria-label="Objetivo" value={objective} onChange={(event) => setObjective(event.target.value)} className="mt-2 w-full rounded-xl border bg-surface-raised px-3 py-2.5 text-sm" /></label>
          <label className="block text-xs font-medium uppercase tracking-wider text-ink-muted">Notas<textarea aria-label="Notas" value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="mt-2 w-full rounded-xl border bg-surface-raised px-3 py-2 text-sm" /></label>
        </fieldset>

        {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <button type="submit" disabled={!title.trim() || isSubmitting} className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white disabled:opacity-40">
          {isSubmitting ? 'Guardando…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
