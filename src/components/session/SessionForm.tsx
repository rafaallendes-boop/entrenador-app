import { useMemo, useRef, useState, type FormEvent } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Link2, Plus, Trash2, X } from 'lucide-react'
import { SESSION_TYPE_CONFIG } from '../../constants/sessionTypes'
import type {
  MatchResult,
  RunningType,
  SessionType,
  SquashSessionBlockKind,
  SquashSubtype,
  TimeBlock,
} from '../../types'
import type { CoachSessionDraft } from '../../services/athlete/coachSessionSerializer'
import {
  EXERCISE_TYPES,
  resolveCoachSquashKind,
} from '../../services/athlete/coachSessionSerializer'
import {
  getCatalogForSport,
  toLibraryRef,
  type CatalogEntry,
} from '../../services/training/coachExerciseCatalog'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
import { todayISO } from '../../utils/date'
import { v4 as uuid } from '../../utils/uuid'
import { normalizeSupersetGroups } from '../../services/training/supersetGroups'
import {
  findSquashDrillByName,
  resolveSquashDrillKind,
} from '../../services/training/drillLibrary'
import {
  isSquashDrillKindCompatible,
  projectSquashSubtype,
} from '../../services/training/squashSessionHydrator'
import ExerciseLibraryBrowser from './ExerciseLibraryBrowser'
import ExerciseNameInput from './ExerciseNameInput'

export interface SessionFormProps {
  initialValues?: CoachSessionDraft
  defaultSport: SessionType
  defaultDate?: string
  heading: string
  submitLabel: string
  mode?: 'session' | 'template'
  initialName?: string
  allowMatchResult?: boolean
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
  libraryRef?: ExerciseLibraryRef
  supersetGroup?: string
  touched: {
    sets: boolean
    reps: boolean
    weight: boolean
    notes: boolean
  }
}

type EditableExerciseField = 'name' | 'sets' | 'reps' | 'weight' | 'notes'

const SESSION_TYPES: SessionType[] = ['squash', 'running', 'cycling', 'strength', 'mobility', 'recovery']
const RUNNING_TYPES: Array<{ value: RunningType; label: string }> = [
  { value: 'z2', label: 'Z2 Aerobico' },
  { value: 'tempo', label: 'Tempo' },
  { value: 'intervals', label: 'Intervalos' },
  { value: 'long', label: 'Long Run' },
]
const SQUASH_KINDS: Array<{ value: SquashSessionBlockKind; label: string }> = [
  { value: 'control', label: 'Control (solo)' },
  { value: 'technical', label: 'Técnico (con partner)' },
  { value: 'shadows', label: 'Sombras (sin pelota)' },
  { value: 'match', label: 'Partido' },
]
const MATCH_CONTEXTS: Array<{ label: string; competitive: boolean }> = [
  { label: 'Práctica', competitive: false },
  { label: 'Competencia', competitive: true },
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
  id: uuid(),
  name: '',
  sets: '3',
  reps: '10',
  weight: '',
  notes: '',
  touched: { sets: false, reps: false, weight: false, notes: false },
})
const optionalNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function leaderIndexOf(exercises: readonly ExerciseDraft[], index: number): number {
  const groupId = exercises[index]?.supersetGroup
  if (groupId == null) return index
  let cursor = index
  while (cursor > 0 && exercises[cursor - 1]!.supersetGroup === groupId) cursor -= 1
  return cursor
}

function unitBoundsOf(
  exercises: readonly ExerciseDraft[],
  index: number,
): { start: number; end: number } {
  const groupId = exercises[index]?.supersetGroup
  if (groupId == null) return { start: index, end: index }
  let start = index
  let end = index
  while (start > 0 && exercises[start - 1]!.supersetGroup === groupId) start -= 1
  while (end < exercises.length - 1 && exercises[end + 1]!.supersetGroup === groupId) end += 1
  return { start, end }
}

/**
 * Los lideres y ejercicios sueltos mueven su unidad completa. Un seguidor solo
 * cambia de posicion dentro de su grupo y nunca atraviesa sus limites.
 */
function reorderSupersetUnits(
  exercises: readonly ExerciseDraft[],
  index: number,
  direction: -1 | 1,
): ExerciseDraft[] {
  const { start, end } = unitBoundsOf(exercises, index)

  if (index !== start) {
    const target = index + direction
    if (target < start || target > end) return [...exercises]
    const next = [...exercises]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    return next
  }

  if (direction === -1) {
    if (start === 0) return [...exercises]
    const previous = unitBoundsOf(exercises, start - 1)
    return [
      ...exercises.slice(0, previous.start),
      ...exercises.slice(start, end + 1),
      ...exercises.slice(previous.start, start),
      ...exercises.slice(end + 1),
    ]
  }

  if (end === exercises.length - 1) return [...exercises]
  const next = unitBoundsOf(exercises, end + 1)
  return [
    ...exercises.slice(0, start),
    ...exercises.slice(end + 1, next.end + 1),
    ...exercises.slice(start, end + 1),
    ...exercises.slice(next.end + 1),
  ]
}

function canMoveExercise(
  exercises: readonly ExerciseDraft[],
  index: number,
  direction: -1 | 1,
): boolean {
  const { start, end } = unitBoundsOf(exercises, index)
  if (index !== start) {
    const target = index + direction
    return target >= start && target <= end
  }
  return direction === -1 ? start > 0 : end < exercises.length - 1
}

export default function SessionForm({
  initialValues,
  defaultSport,
  defaultDate,
  heading,
  submitLabel,
  mode = 'session',
  initialName,
  allowMatchResult = true,
  onSubmit,
  onCancel,
}: SessionFormProps) {
  const initialType = initialValues?.type ?? defaultSport
  const initialSquashKind = initialValues?.squashKind
    ?? resolveCoachSquashKind(undefined, initialValues?.subtype)
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
  const [squashSubtype, setSquashSubtype] = useState<SquashSubtype>(
    initialValues?.subtype ?? projectSquashSubtype(initialSquashKind),
  )
  const [squashKind, setSquashKind] = useState<SquashSessionBlockKind>(initialSquashKind)
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
      libraryRef: exercise.libraryRef,
      supersetGroup: exercise.supersetGroup,
      touched: { sets: true, reps: true, weight: true, notes: true },
    })) ?? []
  ))
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const showExercises = EXERCISE_TYPES.includes(type)
  const catalogEnabled = getCatalogForSport(type).length > 0
  const showRunningFields = type === 'running' || type === 'cycling'
  const hasSquashMatchModality = type === 'squash' && squashKind === 'match'
  const isSquashMatch = !isTemplate && hasSquashMatchModality
  const showLocation = type === 'squash' || type === 'running' || type === 'cycling'
  const config = SESSION_TYPE_CONFIG[type]
  const incompatibleSquashExercises = useMemo(() => {
    if (type !== 'squash') return []
    return exercises.filter((exercise) => {
      if (exercise.libraryRef?.source !== 'squash_drill') return false
      const definition = findSquashDrillByName(exercise.libraryRef.id)
      return definition != null
        && !isSquashDrillKindCompatible(squashKind, resolveSquashDrillKind(definition))
    })
  }, [exercises, squashKind, type])

  const handleTypeChange = (nextType: SessionType) => {
    const previousDefaultTitle = TYPE_LABELS[type]
    const nextTitle = title === previousDefaultTitle ? TYPE_LABELS[nextType] : title
    setType(nextType)
    setTitle(nextTitle)
    if (isTemplate && !nameTouched) setTemplateName(nextTitle)
    if (!EXERCISE_TYPES.includes(nextType)) setExercises([])
    if (nextType !== 'running' && nextType !== 'cycling') {
      setRunningType('z2')
      setPaceMin('')
      setPaceMax('')
      setHrMin('')
      setHrMax('')
    }
    if (nextType !== 'squash') {
      setSquashSubtype('training')
      setSquashKind('technical')
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

  const handleSquashKindChange = (nextKind: SquashSessionBlockKind) => {
    setSquashKind(nextKind)
    setSquashSubtype(projectSquashSubtype(
      nextKind,
      nextKind === 'match' && squashSubtype === 'competitive',
    ))
    if (nextKind !== 'match') {
      setOpponent('')
      setMatchResult('')
      setGamesWon('')
      setGamesLost('')
    }
  }

  const updateExercise = (id: string, field: EditableExerciseField, value: string) => {
    setExercises((current) => {
      const index = current.findIndex((exercise) => exercise.id === id)
      if (index === -1) return current
      const target = current[index]!

      if (field === 'sets') {
        const groupId = target.supersetGroup
        if (groupId != null && index !== leaderIndexOf(current, index)) return current
        return current.map((exercise) => (
          exercise.id === id || (groupId != null && exercise.supersetGroup === groupId)
            ? { ...exercise, sets: value, touched: { ...exercise.touched, sets: true } }
            : exercise
        ))
      }

      return current.map((exercise) => {
        if (exercise.id !== id) return exercise
        if (field === 'name') return { ...exercise, name: value, libraryRef: undefined }
        return {
          ...exercise,
          [field]: value,
          touched: { ...exercise.touched, [field]: true },
        }
      })
    })
  }

  const applyCatalogEntry = (id: string, entry: CatalogEntry) => {
    setExercises((current) => {
      const index = current.findIndex((exercise) => exercise.id === id)
      if (index === -1) return current
      const target = current[index]!
      const groupId = target.supersetGroup
      const isFollower = groupId != null && index !== leaderIndexOf(current, index)
      const shouldApplyDefaultSets = !target.touched.sets && !isFollower
        && entry.defaults.sets !== undefined
      const nextSets = shouldApplyDefaultSets ? String(entry.defaults.sets) : target.sets

      return current.map((exercise) => {
        if (exercise.id === id) {
          return {
            ...exercise,
            name: entry.name,
            libraryRef: toLibraryRef(entry),
            sets: nextSets,
            reps: exercise.touched.reps ? exercise.reps : entry.defaults.reps ?? exercise.reps,
            notes: exercise.touched.notes ? exercise.notes : entry.defaults.notes ?? '',
          }
        }
        if (shouldApplyDefaultSets && groupId != null && exercise.supersetGroup === groupId) {
          return { ...exercise, sets: nextSets }
        }
        return exercise
      })
    })
  }

  const groupBoundaryToggle = (index: number) => {
    setExercises((current) => {
      if (index <= 0 || index >= current.length) return current
      const previous = current[index - 1]!
      const target = current[index]!
      const joined = target.supersetGroup != null
        && target.supersetGroup === previous.supersetGroup

      if (!joined) {
        const left = unitBoundsOf(current, index - 1)
        const right = unitBoundsOf(current, index)
        const groupId = previous.supersetGroup ?? uuid()
        const leaderSets = current[left.start]!.sets
        return current.map((exercise, exerciseIndex) => (
          exerciseIndex >= left.start && exerciseIndex <= right.end
            ? { ...exercise, supersetGroup: groupId, sets: leaderSets }
            : exercise
        ))
      }

      const groupId = target.supersetGroup!
      const bounds = unitBoundsOf(current, index)
      const leftId = index - bounds.start >= 2 ? groupId : undefined
      const rightId = bounds.end - index + 1 >= 2 ? uuid() : undefined

      return current.map((exercise, exerciseIndex) => {
        if (exerciseIndex < bounds.start || exerciseIndex > bounds.end) return exercise
        const nextGroupId = exerciseIndex < index ? leftId : rightId
        const next = { ...exercise }
        if (nextGroupId == null) delete next.supersetGroup
        else next.supersetGroup = nextGroupId
        return next
      })
    })
  }

  const moveExercise = (index: number, direction: -1 | 1) => {
    setExercises((current) => reorderSupersetUnits(current, index, direction))
  }

  const addFromCatalog = (entry: CatalogEntry) => {
    setExercises((current) => [...current, {
      id: uuid(),
      name: entry.name,
      sets: entry.defaults.sets !== undefined ? String(entry.defaults.sets) : '3',
      reps: entry.defaults.reps ?? '10',
      weight: '',
      notes: entry.defaults.notes ?? '',
      libraryRef: toLibraryRef(entry),
      touched: { sets: false, reps: false, weight: false, notes: false },
    }])
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
      squashKind: type === 'squash' ? squashKind : undefined,
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
        ? (() => {
            const submitted = exercises
              .filter((exercise) => exercise.name.trim())
              .map((exercise) => ({
              id: exercise.id,
              name: exercise.name.trim(),
              sets: Number(exercise.sets) || 3,
              reps: exercise.reps.trim() || '10',
              weight: optionalNumber(exercise.weight),
              notes: exercise.notes.trim() || undefined,
              libraryRef: exercise.libraryRef,
              ...(type === 'strength' && exercise.supersetGroup != null
                ? { supersetGroup: exercise.supersetGroup }
                : {}),
              }))
            return type === 'strength' ? normalizeSupersetGroups(submitted) : submitted
          })()
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
    <>
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
              <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Modalidad</span>
              <div className="flex flex-wrap gap-2">
                {SQUASH_KINDS.map((kind) => (
                  <button
                    type="button"
                    key={kind.value}
                    onClick={() => handleSquashKindChange(kind.value)}
                    aria-pressed={squashKind === kind.value}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                      squashKind === kind.value
                        ? `${config.bgClass} ${config.textClass} ${config.borderClass}`
                        : 'border-surface-border bg-surface-raised text-ink-muted'
                    }`}
                  >{kind.label}</button>
                ))}
              </div>
              {hasSquashMatchModality && (
                <div className="mt-3">
                  <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">
                    Contexto del partido
                  </span>
                  <div className="flex gap-2">
                    {MATCH_CONTEXTS.map((matchContext) => {
                      const selected = (squashSubtype === 'competitive') === matchContext.competitive
                      return (
                        <button
                          type="button"
                          key={matchContext.label}
                          aria-pressed={selected}
                          onClick={() => setSquashSubtype(matchContext.competitive ? 'competitive' : 'match')}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                            selected
                              ? `${config.bgClass} ${config.textClass} ${config.borderClass}`
                              : 'border-surface-border bg-surface-raised text-ink-muted'
                          }`}
                        >{matchContext.label}</button>
                      )
                    })}
                  </div>
                </div>
              )}
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
              {allowMatchResult && (
                <>
                  <div className="flex gap-2">
                    {MATCH_RESULTS.map((result) => <button type="button" key={result.value} aria-pressed={matchResult === result.value} onClick={() => setMatchResult((current) => current === result.value ? '' : result.value)} className="rounded-full border px-3 py-1.5 text-xs">{result.label}</button>)}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs uppercase text-ink-muted">Games ganados<input aria-label="Games ganados" type="number" min={0} max={5} value={gamesWon} onChange={(event) => setGamesWon(event.target.value)} className="mt-2 w-full rounded-xl border bg-surface px-3 py-2" /></label>
                    <label className="text-xs uppercase text-ink-muted">Games perdidos<input aria-label="Games perdidos" type="number" min={0} max={5} value={gamesLost} onChange={(event) => setGamesLost(event.target.value)} className="mt-2 w-full rounded-xl border bg-surface px-3 py-2" /></label>
                  </div>
                </>
              )}
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
              {incompatibleSquashExercises.length > 0 && (
                <p role="status" className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Hay drills conocidos incompatibles con la modalidad elegida: {' '}
                  {incompatibleSquashExercises.map((exercise) => exercise.name).join(', ')}.
                  Puedes guardar; no se borrará ni reclasificará el contenido.
                </p>
              )}
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase text-ink-muted">{type === 'mobility' ? 'Ejercicios de movilidad' : 'Ejercicios'}</span>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {catalogEnabled && (
                    <button type="button" onClick={() => setLibraryOpen(true)} className="flex items-center gap-1 text-xs text-brand-light"><BookOpen size={12} /> Agregar desde biblioteca</button>
                  )}
                  <button type="button" onClick={() => setExercises((current) => [...current, emptyExercise()])} className="flex items-center gap-1 text-xs text-brand-light"><Plus size={12} /> Añadir</button>
                </div>
              </div>
              <div className="space-y-3">
                {exercises.map((exercise, index) => {
                  const joinedAbove = type === 'strength'
                    && exercise.supersetGroup != null
                    && exercise.supersetGroup === exercises[index - 1]?.supersetGroup
                  const joinedBelow = type === 'strength'
                    && exercise.supersetGroup != null
                    && exercise.supersetGroup === exercises[index + 1]?.supersetGroup
                  return (
                  <div key={exercise.id} className="relative">
                    {/* Riel de grupo: mismo lenguaje que el checklist. Vive en el
                        envoltorio, no dentro del `space-y-2` de la tarjeta, para
                        no alterar su ritmo vertical. Se extiende al hueco de la
                        lista para dibujar una sola linea por grupo. */}
                    {(joinedAbove || joinedBelow) && (
                      <span
                        aria-hidden
                        className={`absolute left-0 z-10 w-0.5 bg-brand/40 ${joinedAbove ? '-top-3' : 'top-3 rounded-t-full'} ${joinedBelow ? '-bottom-3' : 'bottom-3 rounded-b-full'}`}
                      />
                    )}
                    <div className="space-y-2 rounded-xl bg-surface-raised p-3">
                    {type === 'strength' && index > 0 && (
                      <button
                        type="button"
                        aria-label={`Agrupar ejercicio ${index + 1} con el anterior`}
                        aria-pressed={joinedAbove}
                        onClick={() => groupBoundaryToggle(index)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60 ${
                          joinedAbove
                            ? 'border-brand text-brand'
                            : 'border-surface-border text-ink-muted hover:border-brand/50 hover:text-brand-light'
                        }`}
                      >
                        <Link2 size={11} />
                        Agrupar
                      </button>
                    )}
                    <div className="flex gap-2">
                      {catalogEnabled ? (
                        <ExerciseNameInput
                          index={index}
                          value={exercise.name}
                          sessionType={type}
                          squashKind={type === 'squash' ? squashKind : undefined}
                          onChangeText={(text) => updateExercise(exercise.id, 'name', text)}
                          onSelectEntry={(entry) => applyCatalogEntry(exercise.id, entry)}
                        />
                      ) : (
                        <input aria-label={`Ejercicio ${index + 1}`} value={exercise.name} onChange={(event) => updateExercise(exercise.id, 'name', event.target.value)} className="flex-1 rounded-lg border bg-surface px-2.5 py-1.5" />
                      )}
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Subir ejercicio ${index + 1}`}
                          disabled={!canMoveExercise(exercises, index, -1)}
                          onClick={() => moveExercise(index, -1)}
                          className="rounded-md p-1 text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Bajar ejercicio ${index + 1}`}
                          disabled={!canMoveExercise(exercises, index, 1)}
                          onClick={() => moveExercise(index, 1)}
                          className="rounded-md p-1 text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button type="button" aria-label={`Eliminar ejercicio ${index + 1}`} onClick={() => setExercises((current) => current.filter((item) => item.id !== exercise.id))} className="rounded-md p-1 text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <input aria-label={`Series ${index + 1}`} type="number" value={exercise.sets} readOnly={joinedAbove} title={joinedAbove ? 'Las rondas las define el primer ejercicio del grupo' : undefined} onChange={(event) => updateExercise(exercise.id, 'sets', event.target.value)} className="rounded-lg border bg-surface px-2 py-1.5 read-only:cursor-not-allowed read-only:text-ink-muted" />
                      <input aria-label={`Reps ${index + 1}`} value={exercise.reps} onChange={(event) => updateExercise(exercise.id, 'reps', event.target.value)} className="rounded-lg border bg-surface px-2 py-1.5" />
                      {type === 'strength' && <input aria-label={`Carga ${index + 1}`} type="number" value={exercise.weight} onChange={(event) => updateExercise(exercise.id, 'weight', event.target.value)} className="rounded-lg border bg-surface px-2 py-1.5" />}
                    </div>
                    <input aria-label={`Notas ejercicio ${index + 1}`} value={exercise.notes} onChange={(event) => updateExercise(exercise.id, 'notes', event.target.value)} className="w-full rounded-lg border bg-surface px-2.5 py-1.5" />
                    </div>
                  </div>
                  )
                })}
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
      {libraryOpen && (
        <ExerciseLibraryBrowser
          sessionType={type}
          squashKind={type === 'squash' ? squashKind : undefined}
          onAdd={addFromCatalog}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </>
  )
}
