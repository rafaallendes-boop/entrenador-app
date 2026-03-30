import { useEffect, useMemo, useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import type {
  Exercise,
  MatchResult,
  RunningType,
  SessionType,
  SquashSubtype,
  TimeBlock,
} from '../../types'
import { SESSION_TYPE_CONFIG } from '../../constants/sessionTypes'
import { useTrainingStore } from '../../store/useTrainingStore'
import { todayISO } from '../../utils/date'
import { v4 as uuid } from '../../utils/uuid'

interface Props {
  defaultDate?: string
  onClose: () => void
}

const SESSION_TYPES: SessionType[] = ['squash', 'running', 'strength', 'mobility', 'recovery']

const RUNNING_TYPES: { value: RunningType; label: string }[] = [
  { value: 'z2', label: 'Z2 Aerobico' },
  { value: 'tempo', label: 'Tempo' },
  { value: 'intervals', label: 'Intervalos' },
  { value: 'long', label: 'Long Run' },
]

const SQUASH_SUBTYPES: { value: SquashSubtype; label: string }[] = [
  { value: 'training', label: 'Entrenamiento' },
  { value: 'match', label: 'Partido' },
  { value: 'competitive', label: 'Competitivo' },
  { value: 'control', label: 'Control' },
  { value: 'light', label: 'Suave' },
]

const MATCH_RESULTS: { value: MatchResult; label: string }[] = [
  { value: 'win', label: 'Gane' },
  { value: 'loss', label: 'Perdi' },
]

interface ExerciseDraft {
  id: string
  name: string
  sets: string
  reps: string
  weight: string
  notes: string
}

const emptyExercise = (): ExerciseDraft => ({
  id: uuid(),
  name: '',
  sets: '3',
  reps: '10',
  weight: '',
  notes: '',
})

const TYPE_LABELS: Record<SessionType, string> = {
  squash: 'Sesion de squash',
  running: 'Salida de running',
  strength: 'Sesion de fuerza',
  mobility: 'Movilidad',
  recovery: 'Recuperacion activa',
  nutrition: 'Nutricion',
}

export default function AddSessionModal({ defaultDate, onClose }: Props) {
  const { addSession } = useTrainingStore()

  const [type, setType] = useState<SessionType>('squash')
  const [title, setTitle] = useState(TYPE_LABELS.squash)
  const [date, setDate] = useState(defaultDate ?? todayISO())
  const [timeBlock, setTimeBlock] = useState<TimeBlock>('AM')
  const [duration, setDuration] = useState(60)
  const [rpe, setRpe] = useState<number | ''>('')
  const [objective, setObjective] = useState('')
  const [notes, setNotes] = useState('')
  const [location, setLocation] = useState('')

  const [runningType, setRunningType] = useState<RunningType>('z2')
  const [paceMin, setPaceMin] = useState('')
  const [paceMax, setPaceMax] = useState('')
  const [hrMin, setHrMin] = useState('')
  const [hrMax, setHrMax] = useState('')

  const [squashSubtype, setSquashSubtype] = useState<SquashSubtype>('training')
  const [opponent, setOpponent] = useState('')
  const [matchResult, setMatchResult] = useState<MatchResult | ''>('')
  const [gamesWon, setGamesWon] = useState('')
  const [gamesLost, setGamesLost] = useState('')

  const [exercises, setExercises] = useState<ExerciseDraft[]>([])

  const showExercises = type === 'strength' || type === 'mobility'
  const isSquashMatch = type === 'squash' && (squashSubtype === 'match' || squashSubtype === 'competitive')
  const showLocation = type === 'squash' || type === 'running'

  const typeLabels = useMemo<Record<SessionType, string>>(() => ({
    squash: 'Sesion de squash',
    running: 'Salida de running',
    strength: 'Sesion de fuerza',
    mobility: 'Movilidad',
    recovery: 'Recuperacion activa',
    nutrition: 'Nutricion',
  }), [])

  useEffect(() => {
    setTitle(typeLabels[type])
    if (type !== 'strength' && type !== 'mobility') {
      setExercises([])
    }
    if (type !== 'running') {
      setPaceMin('')
      setPaceMax('')
      setHrMin('')
      setHrMax('')
      setRunningType('z2')
    }
    if (type !== 'squash') {
      setSquashSubtype('training')
      setOpponent('')
      setMatchResult('')
      setGamesWon('')
      setGamesLost('')
    }
    if (type !== 'squash' && type !== 'running') {
      setLocation('')
    }
  }, [type, typeLabels])

  useEffect(() => {
    if (!isSquashMatch) {
      setOpponent('')
      setMatchResult('')
      setGamesWon('')
      setGamesLost('')
    }
  }, [isSquashMatch])

  const addExercise = () => setExercises(prev => [...prev, emptyExercise()])

  const updateExercise = (id: string, field: keyof ExerciseDraft, value: string) => {
    setExercises(prev => prev.map(ex => (ex.id === id ? { ...ex, [field]: value } : ex)))
  }

  const removeExercise = (id: string) => {
    setExercises(prev => prev.filter(ex => ex.id !== id))
  }

  const buildExercises = (): Exercise[] =>
    exercises
      .filter(ex => ex.name.trim())
      .map(ex => ({
        id: ex.id,
        name: ex.name.trim(),
        sets: Number(ex.sets) || 3,
        reps: ex.reps.trim() || '10',
        weight: ex.weight ? Number(ex.weight) : undefined,
        completed: false,
        notes: ex.notes.trim() || undefined,
      }))

  const parseOptionalNumber = (value: string): number | undefined => {
    if (!value.trim()) return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const handleSubmit = async () => {
    if (!title.trim()) return

    await addSession({
      date,
      timeBlock,
      type,
      status: 'planned',
      title: title.trim(),
      objective: objective.trim() || undefined,
      durationMin: duration,
      location: location.trim() || undefined,
      rpe: rpe !== '' ? rpe : undefined,
      notes: notes.trim() || undefined,
      subtype: type === 'squash' ? squashSubtype : undefined,
      opponent: isSquashMatch ? opponent.trim() || undefined : undefined,
      matchResult: isSquashMatch && matchResult ? matchResult : undefined,
      gamesWon: isSquashMatch ? parseOptionalNumber(gamesWon) : undefined,
      gamesLost: isSquashMatch ? parseOptionalNumber(gamesLost) : undefined,
      runningDetails: type === 'running'
        ? {
            runningType,
            targetPaceMin: paceMin || undefined,
            targetPaceMax: paceMax || undefined,
            targetHrMin: hrMin ? Number(hrMin) : undefined,
            targetHrMax: hrMax ? Number(hrMax) : undefined,
          }
        : undefined,
      exercises: showExercises && exercises.length > 0 ? buildExercises() : undefined,
    })

    onClose()
  }

  const cfg = SESSION_TYPE_CONFIG[type]

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative max-h-[92vh] overflow-y-auto rounded-t-2xl border-t border-surface-border bg-surface-card">
        <div className="flex justify-center pb-1 pt-3">
          <div className="h-1 w-10 rounded-full bg-surface-border" />
        </div>

        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <h2 className="text-base font-semibold text-ink">Nueva sesion</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-4 py-4 pb-8">
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Tipo</label>
            <div className="flex flex-wrap gap-2">
              {SESSION_TYPES.map(sessionType => {
                const currentTypeConfig = SESSION_TYPE_CONFIG[sessionType]
                const active = type === sessionType
                return (
                  <button
                    key={sessionType}
                    onClick={() => setType(sessionType)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                      active
                        ? `${currentTypeConfig.bgClass} ${currentTypeConfig.textClass} ${currentTypeConfig.borderClass}`
                        : 'border-surface-border bg-surface-raised text-ink-muted'
                    }`}
                  >
                    {currentTypeConfig.label}
                  </button>
                )
              })}
            </div>
          </div>

          {type === 'squash' && (
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Subtipo</label>
              <div className="flex flex-wrap gap-2">
                {SQUASH_SUBTYPES.map(subtype => (
                  <button
                    key={subtype.value}
                    onClick={() => setSquashSubtype(subtype.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                      squashSubtype === subtype.value
                        ? `${cfg.bgClass} ${cfg.textClass} ${cfg.borderClass}`
                        : 'border-surface-border bg-surface-raised text-ink-muted'
                    }`}
                  >
                    {subtype.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {type === 'running' && (
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Tipo de carrera</label>
              <div className="flex flex-wrap gap-2">
                {RUNNING_TYPES.map(run => (
                  <button
                    key={run.value}
                    onClick={() => setRunningType(run.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                      runningType === run.value
                        ? 'border-sky-500/30 bg-sky-500/15 text-sky-400'
                        : 'border-surface-border bg-surface-raised text-ink-muted'
                    }`}
                  >
                    {run.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Titulo</label>
            <input
              type="text"
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="Nombre de la sesion"
              className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Fecha</label>
              <input
                type="date"
                value={date}
                onChange={event => setDate(event.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink focus:border-brand/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Bloque</label>
              <div className="flex overflow-hidden rounded-xl border border-surface-border">
                {(['AM', 'PM'] as TimeBlock[]).map(block => (
                  <button
                    key={block}
                    onClick={() => setTimeBlock(block)}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                      timeBlock === block ? 'bg-brand text-white' : 'bg-surface-raised text-ink-muted'
                    }`}
                  >
                    {block}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Duracion (min)</label>
              <input
                type="number"
                min={5}
                max={300}
                step={5}
                value={duration}
                onChange={event => setDuration(Number(event.target.value))}
                className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink focus:border-brand/50 focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">RPE planificado</label>
              <input
                type="number"
                min={1}
                max={10}
                value={rpe}
                onChange={event => setRpe(event.target.value === '' ? '' : Number(event.target.value))}
                placeholder="1-10"
                className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
              />
            </div>
          </div>

          {showLocation && (
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Lugar o club <span className="normal-case text-ink-faint">(opcional)</span></label>
              <input
                type="text"
                value={location}
                onChange={event => setLocation(event.target.value)}
                placeholder={type === 'running' ? 'Ej: Parque Bicentenario' : 'Ej: Club Manquehue'}
                className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
              />
            </div>
          )}

          {isSquashMatch && (
            <div className="space-y-3 rounded-2xl border border-surface-border bg-surface-raised/60 p-3">
              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Rival <span className="normal-case text-ink-faint">(opcional)</span></label>
                <input
                  type="text"
                  value={opponent}
                  onChange={event => setOpponent(event.target.value)}
                  placeholder="Nombre del rival"
                  className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Resultado <span className="normal-case text-ink-faint">(opcional)</span></label>
                <div className="flex flex-wrap gap-2">
                  {MATCH_RESULTS.map(result => (
                    <button
                      key={result.value}
                      onClick={() => setMatchResult(current => (current === result.value ? '' : result.value))}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                        matchResult === result.value
                          ? result.value === 'win'
                            ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                            : 'border-rose-500/30 bg-rose-500/15 text-rose-400'
                          : 'border-surface-border bg-surface text-ink-muted'
                      }`}
                    >
                      {result.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Games ganados</label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={gamesWon}
                    onChange={event => setGamesWon(event.target.value)}
                    placeholder="3"
                    className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Games perdidos</label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={gamesLost}
                    onChange={event => setGamesLost(event.target.value)}
                    placeholder="1"
                    className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {type === 'running' && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Ritmo min (min/km)</label>
                  <input
                    type="text"
                    value={paceMin}
                    onChange={event => setPaceMin(event.target.value)}
                    placeholder="Ej: 5:00"
                    className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Ritmo max (min/km)</label>
                  <input
                    type="text"
                    value={paceMax}
                    onChange={event => setPaceMax(event.target.value)}
                    placeholder="Ej: 5:30"
                    className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">FC min (bpm)</label>
                  <input
                    type="number"
                    value={hrMin}
                    onChange={event => setHrMin(event.target.value)}
                    placeholder="140"
                    className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">FC max (bpm)</label>
                  <input
                    type="number"
                    value={hrMax}
                    onChange={event => setHrMax(event.target.value)}
                    placeholder="155"
                    className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {showExercises && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                  {type === 'mobility' ? 'Ejercicios de movilidad' : 'Ejercicios'}
                  <span className="ml-1 normal-case text-ink-faint">(opcional)</span>
                </label>
                <button onClick={addExercise} className="flex items-center gap-1 text-xs font-medium text-brand-light">
                  <Plus size={12} /> Anadir
                </button>
              </div>

              {exercises.length === 0 ? (
                <button
                  onClick={addExercise}
                  className="w-full rounded-xl border border-dashed border-surface-border py-3 text-xs text-ink-faint transition-colors hover:border-brand/40 hover:text-ink-muted"
                >
                  + Anadir ejercicio
                </button>
              ) : (
                <div className="space-y-3">
                  {exercises.map((exercise, index) => (
                    <div key={exercise.id} className="space-y-2 rounded-xl bg-surface-raised p-3">
                      <div className="flex items-center gap-2">
                        <span className="w-4 text-[11px] font-medium text-ink-faint">{index + 1}.</span>
                        <input
                          type="text"
                          value={exercise.name}
                          onChange={event => updateExercise(exercise.id, 'name', event.target.value)}
                          placeholder={type === 'mobility' ? 'Ej: Hip flexor stretch' : 'Ej: Press banca'}
                          className="flex-1 rounded-lg border border-surface-border bg-surface px-2.5 py-1.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
                        />
                        <button onClick={() => removeExercise(exercise.id)} className="p-1 text-ink-faint transition-colors hover:text-red-400">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="flex gap-2 pl-6">
                        <div className="flex-1">
                          <label className="mb-1 block text-[10px] uppercase tracking-wider text-ink-faint">Series</label>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={exercise.sets}
                            onChange={event => updateExercise(exercise.id, 'sets', event.target.value)}
                            className="w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink focus:border-brand/50 focus:outline-none"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="mb-1 block text-[10px] uppercase tracking-wider text-ink-faint">{type === 'mobility' ? 'Reps / seg' : 'Reps'}</label>
                          <input
                            type="text"
                            value={exercise.reps}
                            onChange={event => updateExercise(exercise.id, 'reps', event.target.value)}
                            placeholder={type === 'mobility' ? '30s' : '8'}
                            className="w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
                          />
                        </div>
                        {type === 'strength' && (
                          <div className="flex-1">
                            <label className="mb-1 block text-[10px] uppercase tracking-wider text-ink-faint">Carga (kg)</label>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={exercise.weight}
                              onChange={event => updateExercise(exercise.id, 'weight', event.target.value)}
                              placeholder="-"
                              className="w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
                            />
                          </div>
                        )}
                      </div>
                      <div className="pl-6">
                        <input
                          type="text"
                          value={exercise.notes}
                          onChange={event => updateExercise(exercise.id, 'notes', event.target.value)}
                          placeholder={type === 'mobility' ? 'Foco: cadera, tobillo...' : 'Notas opcionales'}
                          className="w-full rounded-lg border border-surface-border bg-surface px-2.5 py-1.5 text-xs text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={addExercise}
                    className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-surface-border py-2 text-xs text-ink-faint transition-colors hover:border-brand/40 hover:text-ink-muted"
                  >
                    <Plus size={12} /> Anadir ejercicio
                  </button>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Objetivo <span className="normal-case text-ink-faint">(opcional)</span></label>
            <input
              type="text"
              value={objective}
              onChange={event => setObjective(event.target.value)}
              placeholder="Que quieres conseguir?"
              className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-muted">Notas <span className="normal-case text-ink-faint">(opcional)</span></label>
            <textarea
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="Instrucciones, recordatorios..."
              rows={2}
              className="w-full resize-none rounded-xl border border-surface-border bg-surface-raised px-3 py-2 text-sm text-ink placeholder-ink-faint focus:border-brand/50 focus:outline-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-40"
          >
            Agregar sesion
          </button>
        </div>
      </div>
    </div>
  )
}

