import type { Athlete } from '../../types'
import type { PendingAthleteAction, RosterStatus } from './coachWorkspaceTypes'

interface CoachSummaryPanelProps {
  athletes: Athlete[]
  status: RosterStatus
  selfId: string | null
  activeAthleteId: string | null
  pendingAction: PendingAthleteAction | null
  onRetry: () => void
  onOpenWeek: (athleteId: string) => void
  onOpenPlan: (athleteId: string) => void
  onGoToAlumnos: () => void
}

export default function CoachSummaryPanel({
  athletes,
  status,
  selfId,
  activeAthleteId,
  pendingAction,
  onRetry,
  onOpenWeek,
  onOpenPlan,
  onGoToAlumnos,
}: CoachSummaryPanelProps) {
  if (status === 'loading') {
    return <p className="text-sm text-ink-muted">Cargando tus atletas…</p>
  }

  if (status === 'error') {
    return (
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
        No pudimos cargar tu roster.
        <button type="button" onClick={onRetry} className="ml-2 font-semibold underline">
          Reintentar
        </button>
      </div>
    )
  }

  if (athletes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center">
        <p className="text-sm text-ink-muted">Aún no tienes atletas activos.</p>
        <button
          type="button"
          onClick={onGoToAlumnos}
          className="mt-3 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-white/10"
        >
          Ir a Alumnos para crear uno
        </button>
      </div>
    )
  }

  const hasManagedAthletes = athletes.some((athlete) => athlete.id !== selfId)
  // Un switch en vuelo resetea stores globales: mientras haya uno pendiente,
  // ningun CTA de atleta acepta clicks (ver Global Constraints).
  const isLocked = pendingAction !== null

  return (
    <div className="space-y-3">
      {!hasManagedAthletes && (
        <div className="rounded-2xl border border-dashed border-white/15 px-4 py-4 text-center">
          <p className="text-sm text-ink-muted">Aún no agregaste alumnos.</p>
          <button
            type="button"
            onClick={onGoToAlumnos}
            className="mt-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-white/10"
          >
            Ir a Alumnos para agregar el primero
          </button>
        </div>
      )}

      {athletes.map((athlete) => {
        const isSelf = athlete.id === selfId
        const isActive = athlete.id === activeAthleteId
        const isTarget = pendingAction?.athleteId === athlete.id
        const isWeekPending = isTarget && pendingAction?.kind === 'week'
        const isPlanPending = isTarget && pendingAction?.kind === 'plan'
        return (
          // data-* : anclas estables para el smoke de Playwright (Task 8), que debe
          // apuntar al atleta ACTIVO y no al primero de la lista (listRosterAthletes
          // siempre ordena self primero, que no siempre es el activo).
          <div
            key={athlete.id}
            data-athlete-card={athlete.id}
            data-athlete-active={isActive ? 'true' : 'false'}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-ink">
                {isSelf ? 'Tú' : (athlete.displayName ?? 'Atleta')}
              </p>
              {isActive && <p className="text-xs text-brand">Entrenando ahora</p>}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={isLocked}
                onClick={() => onOpenWeek(athlete.id)}
                className="flex-1 rounded-xl border border-white/15 bg-white/5 py-2 text-xs font-semibold text-ink transition-colors hover:bg-white/10"
              >
                {isWeekPending ? 'Abriendo semana…' : 'Ver semana'}
              </button>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => onOpenPlan(athlete.id)}
                className="flex-1 rounded-xl border border-white/15 bg-white/5 py-2 text-xs font-semibold text-ink transition-colors hover:bg-white/10"
              >
                {isPlanPending ? 'Abriendo plan…' : 'Ver plan'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
