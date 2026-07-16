import { useCallback, useEffect, useRef, useState } from 'react'
import type { Athlete, Session } from '../../types'
import {
  currentWeekStartISO,
  formatDay,
  formatDayNum,
  formatWeekRange,
  fromISO,
  nextWeek,
  prevWeek,
  toISO,
} from '../../utils/date'
import { getWeekSessionsForAthlete, hydrateWeekForAthlete } from '../../services/athlete/coachScopedReads'
import type { PendingAthleteAction } from './coachWorkspaceTypes'
import { groupSessionsByDay, sessionStatusLabel } from './planningWeek'

type PlanningPhase = 'loading' | 'ready' | 'error'

interface CoachPlanningPanelProps {
  athletes: Athlete[]
  selfId: string | null
  activeAthleteId: string | null
  ownerAccountId: string
  pendingAction: PendingAthleteAction | null
  onTrainAs: (athleteId: string) => void
  /** Solo tests: renderToStaticMarkup no ejecuta efectos. */
  initialSessions?: Session[]
  /** Solo tests: renderToStaticMarkup no ejecuta efectos. */
  initialPhase?: PlanningPhase
  /** Solo tests: renderToStaticMarkup no ejecuta efectos. */
  initialNotice?: boolean
}

export default function CoachPlanningPanel({
  athletes,
  selfId,
  activeAthleteId,
  ownerAccountId,
  pendingAction,
  onTrainAs,
  initialSessions,
  initialPhase,
  initialNotice,
}: CoachPlanningPanelProps) {
  const isTestMode = initialSessions !== undefined || initialPhase !== undefined || initialNotice !== undefined
  const [selectedId, setSelectedId] = useState<string | null>(activeAthleteId ?? selfId)
  const [weekStart, setWeekStart] = useState(currentWeekStartISO)
  const [sessions, setSessions] = useState<Session[]>(initialSessions ?? [])
  const [phase, setPhase] = useState<PlanningPhase>(initialPhase ?? 'loading')
  const [staleNotice, setStaleNotice] = useState(initialNotice ?? false)
  const epochRef = useRef(0)

  const load = useCallback(async (athleteId: string, week: string, epoch: number) => {
    const isCurrent = () => epochRef.current === epoch

    try {
      const cached = await getWeekSessionsForAthlete(ownerAccountId, athleteId, week)
      if (!isCurrent()) return

      setSessions(cached)
      setStaleNotice(false)
      // Un cache vacio no demuestra que la semana este vacia hasta que termine
      // la hidratacion remota.
      setPhase(cached.length > 0 ? 'ready' : 'loading')

      try {
        await hydrateWeekForAthlete(ownerAccountId, athleteId, week)
        if (!isCurrent()) return
        const hydrated = await getWeekSessionsForAthlete(ownerAccountId, athleteId, week)
        if (!isCurrent()) return
        setSessions(hydrated)
        setPhase('ready')
      } catch {
        if (!isCurrent()) return
        if (cached.length > 0) {
          setStaleNotice(true)
          setPhase('ready')
        } else {
          setPhase('error')
        }
      }
    } catch {
      if (isCurrent()) setPhase('error')
    }
  }, [ownerAccountId])

  useEffect(() => {
    if (isTestMode || !selectedId) return

    const epoch = ++epochRef.current
    void Promise.resolve().then(() => load(selectedId, weekStart, epoch))
    const epochs = epochRef

    // El cleanup invalida esta carga al cambiar atleta/semana y al desmontar.
    // Una respuesta tardia nunca puede pisar la seleccion actual.
    return () => {
      epochs.current++
    }
  }, [isTestMode, load, selectedId, weekStart])

  const selected = athletes.find((athlete) => athlete.id === selectedId) ?? null
  const grouped = groupSessionsByDay(sessions, weekStart)
  const isLocked = pendingAction !== null
  const isEmpty = phase === 'ready' && sessions.length === 0

  function retry() {
    if (!selectedId) return
    const epoch = ++epochRef.current
    setPhase('loading')
    setStaleNotice(false)
    void load(selectedId, weekStart, epoch)
  }

  function selectAthlete(athleteId: string) {
    setPhase('loading')
    setStaleNotice(false)
    setSelectedId(athleteId)
  }

  function selectWeek(week: string) {
    setPhase('loading')
    setStaleNotice(false)
    setWeekStart(week)
  }

  return (
    <section aria-label="Planificación semanal">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label htmlFor="planning-athlete" className="text-sm text-ink-muted">Atleta</label>
        <select
          id="planning-athlete"
          value={selectedId ?? ''}
          disabled={isLocked}
          onChange={(event) => selectAthlete(event.target.value)}
          className="rounded-xl border border-ink/15 bg-transparent px-3 py-2 text-sm text-ink"
        >
          {athletes.map((athlete) => (
            <option key={athlete.id} value={athlete.id}>
              {athlete.id === selfId ? 'Tú' : (athlete.displayName ?? 'Atleta')}
            </option>
          ))}
        </select>
        {selected && selected.id !== activeAthleteId && (
          <button
            type="button"
            disabled={isLocked}
            onClick={() => onTrainAs(selected.id)}
            className="text-sm font-semibold text-brand underline disabled:opacity-50"
          >
            Entrenar como este atleta
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-label="Semana anterior"
          onClick={() => selectWeek(toISO(prevWeek(fromISO(weekStart))))}
          className="text-sm font-semibold text-brand underline"
        >
          ←
        </button>
        <span className="text-sm font-semibold text-ink">{formatWeekRange(fromISO(weekStart))}</span>
        <button
          type="button"
          aria-label="Semana siguiente"
          onClick={() => selectWeek(toISO(nextWeek(fromISO(weekStart))))}
          className="text-sm font-semibold text-brand underline"
        >
          →
        </button>
        <button
          type="button"
          disabled={weekStart === currentWeekStartISO()}
          onClick={() => selectWeek(currentWeekStartISO())}
          className="text-sm font-semibold text-brand underline disabled:text-ink-muted disabled:no-underline"
        >
          Hoy
        </button>
      </div>

      {staleNotice && (
        <p className="mb-3 text-xs text-amber-200/80">
          No se pudo actualizar desde el servidor; estás viendo los datos guardados en este dispositivo.
        </p>
      )}

      {phase === 'error' && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
        >
          No pudimos cargar la semana.
          <button type="button" className="ml-2 font-semibold underline" onClick={retry}>
            Reintentar
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <p role="status" className="text-sm text-ink-muted">Cargando la semana…</p>
      )}

      {isEmpty && (
        <p className="text-sm text-ink-muted">Esta semana no tiene sesiones planificadas.</p>
      )}

      {phase === 'ready' && sessions.length > 0 && (
        <div className="space-y-4">
          {grouped.map(({ date, sessions: daySessions }) => daySessions.length > 0 && (
            <div key={date}>
              <h3 className="mb-2 text-xs font-semibold uppercase text-ink-muted">
                {formatDay(fromISO(date))} {formatDayNum(fromISO(date))}
              </h3>
              <div className="space-y-2">
                {daySessions.map((session) => (
                  <article key={session.id} className="rounded-2xl border border-ink/10 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-ink">{session.title}</span>
                      <span className="text-xs text-ink-muted">{sessionStatusLabel(session.status)}</span>
                    </div>
                    <p className="text-xs text-ink-muted">{session.type} · {session.durationMin} min</p>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
