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
import { getWeekSessionsForAthlete } from '../../services/athlete/coachScopedReads'
import { resolveAthleteWeekScope } from '../../services/athlete/athleteWeekScope'
import {
  ensureWeekHydrated,
  isWeekHydrated,
} from '../../services/athlete/coachPlanningHydration'
import { deleteSessionForAthlete } from '../../services/athlete/coachScopedWrites'
import { hasRecordedWork } from '../../utils/sessionRecordedWork'
import ConfirmDialog from '../ui/ConfirmDialog'
import CoachSessionModal from './CoachSessionModal'
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
  /** Solo tests: renderToStaticMarkup no ejecuta efectos. */
  initialCanMutate?: boolean
}

type SessionModalState =
  | { mode: 'create'; date: string }
  | { mode: 'edit'; session: Session }

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
  initialCanMutate,
}: CoachPlanningPanelProps) {
  const isTestMode = initialSessions !== undefined
    || initialPhase !== undefined
    || initialNotice !== undefined
    || initialCanMutate !== undefined
  const [selectedId, setSelectedId] = useState<string | null>(activeAthleteId ?? selfId)
  const [weekStart, setWeekStart] = useState(currentWeekStartISO)
  const [sessions, setSessions] = useState<Session[]>(initialSessions ?? [])
  const [phase, setPhase] = useState<PlanningPhase>(initialPhase ?? 'loading')
  const [staleNotice, setStaleNotice] = useState(initialNotice ?? false)
  const [canMutate, setCanMutate] = useState(initialCanMutate ?? false)
  const [modal, setModal] = useState<SessionModalState | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<Session | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const epochRef = useRef(0)
  const deletingRef = useRef(false)

  const load = useCallback(async (athleteId: string, week: string, epoch: number) => {
    const isCurrent = () => epochRef.current === epoch
    setCanMutate(false)

    try {
      const scope = await resolveAthleteWeekScope(ownerAccountId, athleteId)
      if (!isCurrent()) return
      const cached = await getWeekSessionsForAthlete(ownerAccountId, athleteId, week)
      if (!isCurrent()) return

      setSessions(cached)
      setStaleNotice(false)
      // Un cache vacio no demuestra que la semana este vacia hasta que termine
      // la hidratacion remota.
      setPhase(cached.length > 0 ? 'ready' : 'loading')

      try {
        await ensureWeekHydrated(ownerAccountId, scope, week, { force: true })
        if (!isCurrent()) return
        const hydrated = await getWeekSessionsForAthlete(ownerAccountId, athleteId, week)
        if (!isCurrent()) return
        setSessions(hydrated)
        setCanMutate(isWeekHydrated(ownerAccountId, athleteId, week))
        setPhase('ready')
      } catch {
        if (!isCurrent()) return
        setCanMutate(isWeekHydrated(ownerAccountId, athleteId, week))
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
  const isLocked = pendingAction !== null || deleting || modal !== null

  const reload = useCallback(async () => {
    if (!selectedId) return
    const reloadEpoch = epochRef.current
    const currentId = selectedId
    const currentWeek = weekStart
    const rows = await getWeekSessionsForAthlete(ownerAccountId, currentId, currentWeek)
    if (epochRef.current !== reloadEpoch) return
    setSessions(rows)
    setCanMutate(isWeekHydrated(ownerAccountId, currentId, currentWeek))
  }, [ownerAccountId, selectedId, weekStart])

  function retry() {
    if (!selectedId) return
    const epoch = ++epochRef.current
    setPhase('loading')
    setStaleNotice(false)
    setCanMutate(false)
    setDeleteError(null)
    setConfirmTarget(null)
    setModal(null)
    void load(selectedId, weekStart, epoch)
  }

  function selectAthlete(athleteId: string) {
    epochRef.current++
    setPhase('loading')
    setStaleNotice(false)
    setCanMutate(false)
    setDeleteError(null)
    setConfirmTarget(null)
    setModal(null)
    setSelectedId(athleteId)
  }

  function selectWeek(week: string) {
    epochRef.current++
    setPhase('loading')
    setStaleNotice(false)
    setCanMutate(false)
    setDeleteError(null)
    setConfirmTarget(null)
    setModal(null)
    setWeekStart(week)
  }

  async function performDelete(session: Session) {
    if (!selectedId || deletingRef.current) return
    deletingRef.current = true
    setDeleteError(null)
    setDeleting(true)
    try {
      await deleteSessionForAthlete(ownerAccountId, selectedId, session.id)
      setConfirmTarget(null)
      await reload()
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'No se pudo borrar la sesión.')
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  function requestDelete(session: Session) {
    if (deletingRef.current) return
    if (hasRecordedWork(session)) setConfirmTarget(session)
    else void performDelete(session)
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

      {deleteError && (
        <div role="alert" className="mb-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {deleteError}
        </div>
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

      {phase === 'ready' && (
        <div className="space-y-4">
          {!canMutate && (
            <p className="text-xs text-ink-muted">Actualizá la semana para editar.</p>
          )}
          {grouped.map(({ date, sessions: daySessions }) => (
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
                    <div className="mt-2 flex gap-3">
                      <button
                        type="button"
                        disabled={isLocked || !canMutate}
                        onClick={() => setModal({ mode: 'edit', session })}
                        className="text-xs font-semibold text-brand underline disabled:opacity-50"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={isLocked || !canMutate}
                        onClick={() => requestDelete(session)}
                        className="text-xs font-semibold text-red-400 underline disabled:opacity-50"
                      >
                        Borrar
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <button
                type="button"
                disabled={isLocked || !canMutate}
                onClick={() => setModal({ mode: 'create', date })}
                className="mt-1 text-xs font-semibold text-brand underline disabled:opacity-50"
              >
                + Agregar sesión
              </button>
            </div>
          ))}
        </div>
      )}

      {modal && selectedId && (
        <CoachSessionModal
          ownerAccountId={ownerAccountId}
          athleteId={selectedId}
          defaultDate={modal.mode === 'create' ? modal.date : modal.session.date}
          session={modal.mode === 'edit' ? modal.session : undefined}
          onClose={() => setModal(null)}
          onSaved={() => { void reload() }}
        />
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        title="Borrar sesión"
        message="Esta sesión tiene trabajo registrado del atleta; se borrará también ese registro."
        confirmLabel="Borrar"
        destructive
        isLoading={deleting}
        onConfirm={() => { if (confirmTarget) void performDelete(confirmTarget) }}
        onCancel={() => { if (!deletingRef.current) setConfirmTarget(null) }}
      />
    </section>
  )
}
