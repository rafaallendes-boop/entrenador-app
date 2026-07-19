import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Users } from 'lucide-react'
import { useAuthStore } from '../store/useAuthStore'
import { isCoachAccount } from '../services/athlete/coachAccess'
import { getSelfAthleteId } from '../services/athlete/activeAthlete'
import {
  archiveManagedAthlete,
  createManagedAthlete,
  deleteManagedAthletePermanently,
  listArchivedAthletes,
  listOwnedAthletes,
  restoreManagedAthlete,
} from '../services/athlete/managedAthletes'
import { switchActiveAthlete } from '../services/athlete/switchActiveAthlete'
import {
  acquireAthleteActionLock,
  createAndActivateAthlete,
  getCoachRosterRevision,
  notifyCoachRosterChanged,
  releaseAthleteActionLock,
  selectAthleteAndNavigate,
  subscribeCoachRosterRevision,
} from '../services/athlete/coachWorkspaceActions'
import { ROUTES } from '../constants/routes'
import type { Athlete } from '../types'
import type { CoachWorkspaceTab, PendingAthleteAction, RosterStatus } from '../components/coach/coachWorkspaceTypes'
import CoachWorkspaceNav from '../components/coach/CoachWorkspaceNav'
import { coachTabId, coachTabPanelId } from '../components/coach/coachWorkspaceTypes'
import CoachSummaryPanel from '../components/coach/CoachSummaryPanel'
import CoachRosterPanel from '../components/coach/CoachRosterPanel'
import CoachPlanningPanel from '../components/coach/CoachPlanningPanel'
import CoachLibraryPanel from '../components/coach/CoachLibraryPanel'
import CoachWorkspacePlaceholderPanel from '../components/coach/CoachWorkspacePlaceholderPanel'

interface CoachWorkspacePageProps {
  /** Solo tests: inyecta la allowlist sin depender de import.meta.env. */
  allowlistOverride?: string
  /** Solo tests: roster inicial (renderToStaticMarkup no ejecuta efectos). */
  initialAthletes?: Athlete[]
  /** Solo tests: archivados iniciales (renderToStaticMarkup no ejecuta efectos). */
  initialArchivedAthletes?: Athlete[]
  /** Solo tests: tab inicial (renderToStaticMarkup no ejecuta clicks). */
  initialTab?: CoachWorkspaceTab
}

export default function CoachWorkspacePage({
  allowlistOverride,
  initialAthletes,
  initialArchivedAthletes,
  initialTab,
}: CoachWorkspacePageProps) {
  const user = useAuthStore((state) => state.user)
  const activeAthleteId = useAuthStore((state) => state.activeAthleteId)
  const [athletes, setAthletes] = useState<Athlete[]>(initialAthletes ?? [])
  const [archivedAthletes, setArchivedAthletes] = useState<Athlete[]>(initialArchivedAthletes ?? [])
  const [status, setStatus] = useState<RosterStatus>(initialAthletes ? 'ready' : 'loading')
  const [activeTab, setActiveTab] = useState<CoachWorkspaceTab>(initialTab ?? 'resumen')
  const [reloadToken, setReloadToken] = useState(0)
  const [pendingAthleteAction, setPendingAthleteAction] = useState<PendingAthleteAction | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const navigate = useNavigate()
  const rosterRevision = useSyncExternalStore(
    subscribeCoachRosterRevision,
    getCoachRosterRevision,
    getCoachRosterRevision,
  )

  const isCoach = allowlistOverride !== undefined
    ? isCoachAccount(user, allowlistOverride)
    : isCoachAccount(user)

  useEffect(() => {
    if (!isCoach || !user?.id) return
    let cancelled = false
    setStatus('loading')
    Promise.all([listOwnedAthletes(user.id), listArchivedAthletes(user.id)])
      .then(([activeRows, archivedRows]) => {
        if (cancelled) return
        setAthletes(activeRows)
        setArchivedAthletes(archivedRows)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => { cancelled = true }
  }, [isCoach, user?.id, activeAthleteId, reloadToken, rosterRevision])

  const handleAthleteAction = useCallback(async (
    athleteId: string,
    kind: 'week' | 'plan' | 'trainAs',
    destination: string,
  ) => {
    if (!user?.id) return
    // Serializacion global: un switch (o una creacion, que tambien activa) en vuelo
    // ya esta reseteando stores. El lock vive en el modulo (coachWorkspaceActions),
    // no en un ref de este componente: un switch exitoso remonta esta pagina
    // (AppShell hace key={activeAthleteId}) ANTES de que este handler termine,
    // y un ref local se perderia en ese remount — ver la nota en el propio lock.
    if (!acquireAthleteActionLock()) return
    setActionMessage(null)
    setPendingAthleteAction({ athleteId, kind })
    try {
      const result = await selectAthleteAndNavigate(
        { switchActiveAthlete, navigate },
        user.id,
        athleteId,
        activeAthleteId,
        destination,
      )
      if (!result.navigated) {
        setActionMessage('No se pudo cambiar de atleta. Intenta de nuevo.')
      }
    } catch {
      // switchActiveAthlete todavia puede rechazar en su acceso a Dexie PRE-commit
      // (post-commit, Task 2b lo dejo best-effort). Ahi el scope no cambio.
      setActionMessage('No se pudo cambiar de atleta. Intenta de nuevo.')
    } finally {
      // Este finally corre aunque la instancia que lo inicio ya se haya
      // desmontado (la funcion async sigue hasta el final igual): por eso el
      // lock de modulo se libera de forma confiable, remount mediante.
      releaseAthleteActionLock()
      setPendingAthleteAction(null)
    }
  }, [user?.id, activeAthleteId, navigate])

  if (!isCoach || !user?.id) return <Navigate to={ROUTES.HOME} replace />

  const selfId = getSelfAthleteId()

  async function handleCreateAthlete(name: string) {
    if (!user?.id) throw new Error('Sesión inválida.')
    // Crear tambien activa: toma el MISMO lock (de modulo) que un switch, no uno propio.
    if (!acquireAthleteActionLock()) throw new Error('Espera a que termine la acción en curso.')
    setActionMessage(null)
    setPendingAthleteAction({ kind: 'create', athleteId: null })

    try {
      // Solo esta linea puede lanzar hacia el panel: si lanza, el atleta no existe.
      const result = await createAndActivateAthlete(
        { createManagedAthlete, switchActiveAthlete },
        user.id,
        name,
      )

      // A partir de aca el atleta YA existe en Dexie. Nada de lo que sigue puede
      // propagar: seria reportar como fallo una creacion que si ocurrio.
      try {
        setAthletes(await listOwnedAthletes(user.id))
        setStatus('ready')
      } catch {
        setStatus('error') // el panel muestra "Reintentar"
      }

      if (result.activated) {
        navigate(ROUTES.ONBOARDING)
        return
      }
      setActionMessage(
        `Se creó a "${result.athlete.displayName ?? name}", pero no se pudo activar automáticamente. ` +
        'Usa "Entrenar como este atleta" en la lista para abrir su perfil.',
      )
    } finally {
      releaseAthleteActionLock()
      setPendingAthleteAction(null)
    }
  }

  async function withRosterAction(
    athleteId: string,
    kind: 'archive' | 'restore' | 'delete',
    run: () => Promise<unknown>,
    failureMessage: string,
  ) {
    if (!user?.id) return
    if (!acquireAthleteActionLock()) return

    setActionMessage(null)
    setPendingAthleteAction({ athleteId, kind })
    try {
      if ((kind === 'archive' || kind === 'delete') && athleteId === activeAthleteId) {
        const ownAthleteId = getSelfAthleteId()
        if (!ownAthleteId || !(await switchActiveAthlete(user.id, ownAthleteId))) {
          setActionMessage('No se pudo volver a tu perfil antes de la acción. Intenta de nuevo.')
          return
        }
      }

      await run()
      // La revisión externa es la única fuente de recarga. El efecto asociado
      // hidrata ambos rosters una vez; no duplicamos el mismo fetch aquí.
      notifyCoachRosterChanged()
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : failureMessage)
    } finally {
      releaseAthleteActionLock()
      setPendingAthleteAction(null)
    }
  }

  function handleRetry() {
    setReloadToken((token) => token + 1)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-8 pt-12 md:grid md:grid-cols-[200px_1fr] md:items-start md:gap-6">
      <div className="mb-6 flex items-center gap-2 md:col-span-2">
        <Users size={20} className="text-brand" />
        <h1 className="font-display text-2xl font-bold text-ink">Workspace de coach</h1>
      </div>

      <CoachWorkspaceNav activeTab={activeTab} onSelect={setActiveTab} />

      <div role="tabpanel" id={coachTabPanelId(activeTab)} aria-labelledby={coachTabId(activeTab)} tabIndex={0}>
        {actionMessage && (
          <p role="alert" className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {actionMessage}
          </p>
        )}

        {activeTab === 'resumen' && (
          <CoachSummaryPanel
            athletes={athletes}
            status={status}
            selfId={selfId}
            activeAthleteId={activeAthleteId}
            pendingAction={pendingAthleteAction}
            onRetry={handleRetry}
            onOpenWeek={(athleteId) => void handleAthleteAction(athleteId, 'week', ROUTES.WEEK)}
            onOpenPlan={(athleteId) => void handleAthleteAction(athleteId, 'plan', ROUTES.PLAN_BUILDER_V2)}
            onGoToAlumnos={() => setActiveTab('alumnos')}
          />
        )}

        {activeTab === 'alumnos' && (
          <CoachRosterPanel
            athletes={athletes}
            archivedAthletes={archivedAthletes}
            status={status}
            selfId={selfId}
            activeAthleteId={activeAthleteId}
            pendingAction={pendingAthleteAction}
            onRetry={handleRetry}
            onCreateAthlete={handleCreateAthlete}
            onTrainAs={(athleteId) => void handleAthleteAction(athleteId, 'trainAs', ROUTES.HOME)}
            onArchive={(athleteId) => void withRosterAction(
              athleteId,
              'archive',
              () => archiveManagedAthlete(user.id, athleteId),
              'No se pudo archivar.',
            )}
            onRestore={(athleteId) => void withRosterAction(
              athleteId,
              'restore',
              () => restoreManagedAthlete(user.id, athleteId),
              'No se pudo restaurar.',
            )}
            onDelete={(athleteId) => void withRosterAction(
              athleteId,
              'delete',
              () => deleteManagedAthletePermanently(user.id, athleteId),
              'No se pudo eliminar.',
            )}
          />
        )}

        {activeTab === 'planificacion' && (
          <CoachPlanningPanel
            athletes={athletes}
            selfId={selfId}
            activeAthleteId={activeAthleteId}
            ownerAccountId={user.id}
            pendingAction={pendingAthleteAction}
            onTrainAs={(athleteId) => void handleAthleteAction(athleteId, 'trainAs', ROUTES.HOME)}
          />
        )}

        {activeTab === 'biblioteca' && (
          <CoachLibraryPanel />
        )}

        {activeTab === 'asistente' && (
          <CoachWorkspacePlaceholderPanel
            title="Asistente IA"
            description="El asistente va a proponer cambios de sesión, semana o plan: tú revisas y confirmas antes de aplicarlos."
          />
        )}
      </div>
    </div>
  )
}
