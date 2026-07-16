import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Athlete } from '../../types'
import type { PendingAthleteAction, RosterStatus } from './coachWorkspaceTypes'
import { isDeleteConfirmed } from './deleteConfirmation'

interface CoachRosterPanelProps {
  athletes: Athlete[]
  archivedAthletes: Athlete[]
  status: RosterStatus
  selfId: string | null
  activeAthleteId: string | null
  pendingAction: PendingAthleteAction | null
  onRetry: () => void
  onCreateAthlete: (name: string) => Promise<void>
  onTrainAs: (athleteId: string) => void
  onArchive: (athleteId: string) => void
  onRestore: (athleteId: string) => void
  onDelete: (athleteId: string) => void
  /** Solo tests: renderToStaticMarkup no puede abrir el diálogo. */
  initialDeleteTargetId?: string
}

export default function CoachRosterPanel({
  athletes,
  archivedAthletes,
  status,
  selfId,
  activeAthleteId,
  pendingAction,
  onRetry,
  onCreateAthlete,
  onTrainAs,
  onArchive,
  onRestore,
  onDelete,
  initialDeleteTargetId,
}: CoachRosterPanelProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(initialDeleteTargetId ?? null)
  const [deleteInput, setDeleteInput] = useState('')

  // Una accion en vuelo resetea stores globales: mientras haya una pendiente,
  // ni los switches ni la creacion (que tambien activa) aceptan clicks.
  // El estado de "creando" viene del lock del container, no de un flag local:
  // dos fuentes de verdad para lo mismo se desincronizan.
  const isLocked = pendingAction !== null
  const isSubmitting = pendingAction?.kind === 'create'
  const deleteTarget = archivedAthletes.find((athlete) => athlete.id === deleteTargetId) ?? null
  const canManage = (athlete: Athlete) => athlete.id !== selfId && athlete.linkedAccountId == null

  async function handleCreate() {
    if (isLocked) return
    setError(null)
    try {
      await onCreateAthlete(newName)
      setNewName('')
      setIsCreating(false)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'No se pudo crear el atleta.')
    }
  }

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

  return (
    <div>
      {athletes.length === 0 && (
        <p className="mb-3 text-sm text-ink-muted">Aún no tienes atletas. Crea el primero.</p>
      )}

      <div className="space-y-3">
        {athletes.map((athlete) => {
          const isSelf = athlete.id === selfId
          const isActive = athlete.id === activeAthleteId
          const isPending = pendingAction?.athleteId === athlete.id && pendingAction.kind === 'trainAs'
          return (
            <div
              key={athlete.id}
              data-athlete-row={athlete.id}
              data-athlete-active={isActive ? 'true' : 'false'}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {isSelf ? 'Tú' : (athlete.displayName ?? 'Atleta')}
                </p>
                {isActive && <p className="text-xs text-brand">Entrenando ahora</p>}
              </div>
              {(!isActive || canManage(athlete)) && (
                <div className="flex flex-shrink-0 items-center gap-3">
                  {!isActive && (
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => onTrainAs(athlete.id)}
                      className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-white/10 disabled:opacity-50"
                    >
                      {isPending ? 'Cambiando atleta…' : 'Entrenar como este atleta'}
                    </button>
                  )}
                  {canManage(athlete) && (
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => onArchive(athlete.id)}
                      className="text-xs text-ink-muted underline disabled:opacity-50"
                    >
                      Archivar
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Un solo <form> persistente envuelve los dos estados (colapsado y expandido).
          Esto es deliberado, no cosmético: el test "con solo self" hace un render
          inicial (sin clicks — renderToStaticMarkup no puede disparar eventos) y
          espera encontrar tanto `<form` como el texto "Crear atleta" AL MISMO TIEMPO.
          Si el <form> solo existiera dentro de la rama isCreating=true, ese render
          inicial (isCreating=false) nunca lo montaria y el test fallaria siempre —
          incompatibilidad real entre el test y una implementacion con dos ramas
          <form>/<button> separadas. Con el <form> como wrapper de ambas ramas, el
          submit-por-Enter (Task 5's ask) sigue funcionando exactamente igual una vez
          expandido, porque el <input> y el <button type="submit"> quedan dentro del
          mismo <form onSubmit>. */}
      <form
        onSubmit={(event) => { event.preventDefault(); void handleCreate() }}
        className="mt-4"
      >
        {isCreating ? (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-ink-muted">Nombre del atleta</span>
              <input
                type="text"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Ej. Juan Pérez"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-ink outline-none"
              />
            </label>
            {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setIsCreating(false); setError(null) }}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-ink-muted"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!newName.trim() || isLocked}
                className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {isSubmitting ? 'Creando…' : 'Crear y completar perfil'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={isLocked}
            onClick={() => setIsCreating(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 py-3 text-sm font-semibold text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
          >
            <Plus size={16} />
            Crear atleta
          </button>
        )}
      </form>

      {archivedAthletes.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-ink-muted">
            Archivados ({archivedAthletes.length})
          </summary>
          <div className="mt-3 space-y-3">
            {archivedAthletes.map((athlete) => (
              <div
                key={athlete.id}
                data-archived-row={athlete.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <span className="min-w-0 truncate text-sm text-ink-muted">
                  {athlete.displayName ?? 'Atleta'}
                </span>
                {canManage(athlete) ? (
                  <div className="flex flex-shrink-0 gap-3">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => onRestore(athlete.id)}
                      className="text-xs font-semibold text-ink underline disabled:opacity-50"
                    >
                      Restaurar
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => {
                        setDeleteTargetId(athlete.id)
                        setDeleteInput('')
                      }}
                      className="text-xs text-rose-300 underline disabled:opacity-50"
                    >
                      Eliminar definitivamente
                    </button>
                  </div>
                ) : (
                  <span className="flex-shrink-0 text-xs text-ink-muted">Cuenta vinculada</span>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-athlete-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-sm rounded-2xl border border-rose-500/25 bg-surface p-5">
            <h3 id="delete-athlete-title" className="font-display text-lg font-bold text-ink">
              Eliminar definitivamente
            </h3>
            <p className="mt-2 text-sm text-ink-muted">
              Vas a borrar todos los datos de{' '}
              <strong>{deleteTarget.displayName ?? 'este atleta'}</strong>, locales y del servidor.
              Esto no se puede deshacer. Escribe el nombre para confirmar.
            </p>
            <input
              value={deleteInput}
              onChange={(event) => setDeleteInput(event.target.value)}
              aria-label="Nombre del atleta para confirmar"
              placeholder={deleteTarget.displayName ?? ''}
              className="mt-3 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 text-sm text-ink"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setDeleteTargetId(null)
                  setDeleteInput('')
                }}
                className="text-sm text-ink-muted underline"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isLocked || !isDeleteConfirmed(deleteInput, deleteTarget.displayName)}
                onClick={() => {
                  onDelete(deleteTarget.id)
                  setDeleteTargetId(null)
                  setDeleteInput('')
                }}
                className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
