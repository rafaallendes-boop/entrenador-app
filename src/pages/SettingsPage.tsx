import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Brain, Download, LogOut, RotateCcw, ShieldAlert, Trash2, Upload, User } from 'lucide-react'
import Card from '../components/ui/Card'
import AthleteProfileEditor from '../components/settings/AthleteProfileEditor'
import SyncStatusBadge from '../components/sync/SyncStatusBadge'
import SyncDiagnosticsPanel from '../components/sync/SyncDiagnosticsPanel'
import { ROUTES } from '../constants/routes'
import {
  downloadAppDataExport,
  downloadAthleteProfileTestExport,
  importAppDataFromFile,
  previewAppDataImportFile,
  type AppDataImportPreview,
} from '../services/dataExport'
import { clearSchemaMismatchBlocks, clearSelectedRemoteAppData, clearSelectedSyncArtifactsForUser, runFullSync, wipeRemoteAndLocalAppData } from '../services/syncService'
import {
  clearAllLocalAppData,
  clearSelectedLocalAppData,
  deleteCoachSessionsByIds,
  getLocalDataCounts,
  getRecentCoachSessions,
  type LocalDataCounts,
  type LocalDataGroup,
  type LocalDataSelection,
} from '../services/appMaintenance'
import {
  getNotificationPreferences,
  getNotificationPermission,
  notificationsSupported,
  refreshTodayNotifications,
  requestNotificationPermission,
  saveNotificationPreferences,
  type NotificationPreferences,
} from '../services/notifications'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { useAuthStore } from '../store/useAuthStore'
import { useAIDebugStore } from '../store/useAIDebugStore'
import { useTrainingStore } from '../store/useTrainingStore'
import { currentWeekStartISO } from '../utils/date'
import { getEnabledSports, getSportPrioritySummary } from '../utils/athlete'
import { clearAllOnboardingSkipped, clearOnboardingSkipped } from '../utils/onboarding'
import type { AITechnicalResult, AthleteProfile, Session } from '../types'
import { buildMacroWeekCoherenceSummary } from '../services/macroWeekCoherence'
import { isDevToolsEnabled } from '../services/devTools'
import {
  downloadBetaQualitySnapshot,
  getBetaQualitySnapshot,
  resetPlanBuilderDailyUsage,
  type BetaQualitySnapshot,
} from '../services/ai/aiTelemetry'

const CLEARABLE_GROUPS: Array<{
  key: LocalDataGroup
  title: string
  description: string
}> = [
  {
    key: 'trainingData',
    title: 'Entrenamiento',
    description: 'Sesiones, check-ins y resumenes semanales.',
  },
  {
    key: 'chatHistory',
    title: 'Chat de RallyIQ',
    description: 'Conversaciones guardadas de RallyIQ actuales y anteriores.',
  },
  {
    key: 'coachProposals',
    title: 'Proposals de RallyIQ',
    description: 'Propuestas por revisar, aceptadas o rechazadas.',
  },
  {
    key: 'coachMemory',
    title: 'Memoria de RallyIQ',
    description: 'Contexto persistente del atleta, lesiones y preferencias.',
  },
]

const EMPTY_CLEAR_SELECTION: LocalDataSelection = {
  trainingData: false,
  chatHistory: false,
  coachProposals: false,
  coachMemory: false,
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const { coachMemory, athleteProfile, isSaving, loadMemory, saveMemory, saveAthleteProfile } = useCoachMemoryStore()
  const { user, signOut, syncStatus, syncError, syncDetails } = useAuthStore()
  const aiDebugRequests = useAIDebugStore((state) => state.requests)
  const { sessions, dayLogs, currentWeekSummary, loadWeek } = useTrainingStore()
  const [memoryDraft, setMemoryDraft] = useState('')
  const [memorySaved, setMemorySaved] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null)
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(getNotificationPreferences())
  const [dataCounts, setDataCounts] = useState<LocalDataCounts | null>(null)
  const [clearSelection, setClearSelection] = useState<LocalDataSelection>(EMPTY_CLEAR_SELECTION)
  const [isExporting, setIsExporting] = useState(false)
  const [isExportingProfile, setIsExportingProfile] = useState(false)
  const [isExportingBetaQuality, setIsExportingBetaQuality] = useState(false)
  const [isResettingPlanBuilderUsage, setIsResettingPlanBuilderUsage] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isDeletingCoachSessions, setIsDeletingCoachSessions] = useState(false)
  const [isWipingAllData, setIsWipingAllData] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [profileExportStatus, setProfileExportStatus] = useState<string | null>(null)
  const [betaQualityStatus, setBetaQualityStatus] = useState<string | null>(null)
  const [betaQualitySnapshot, setBetaQualitySnapshot] = useState<BetaQualitySnapshot | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [clearStatus, setClearStatus] = useState<string | null>(null)
  const [coachSessionStatus, setCoachSessionStatus] = useState<string | null>(null)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [importPreview, setImportPreview] = useState<AppDataImportPreview | null>(null)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace')
  const [coachSessionRange, setCoachSessionRange] = useState<1 | 2 | 3 | 4>(4)
  const [coachSessions, setCoachSessions] = useState<Session[]>([])
  const [selectedCoachSessionIds, setSelectedCoachSessionIds] = useState<string[]>([])
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const showDevTools = isDevToolsEnabled()

  const refreshNotificationStatus = () => {
    setNotifPermission(getNotificationPermission())
    setNotificationPreferences(getNotificationPreferences())
  }

  useEffect(() => {
    void loadMemory()
    void loadWeek(currentWeekStartISO())
    void refreshCounts(setDataCounts)
    void refreshNotificationStatus()
  }, [loadMemory, loadWeek])

  const refreshBetaQualitySnapshot = useCallback(async () => {
    const snapshot = await getBetaQualitySnapshot(50)
    setBetaQualitySnapshot(snapshot)
  }, [])

  useEffect(() => {
    void refreshBetaQualitySnapshot()
  }, [aiDebugRequests.length, refreshBetaQualitySnapshot])

  const refreshCoachSessions = useCallback(async () => {
    const nextSessions = await getRecentCoachSessions(coachSessionRange)
    setCoachSessions(nextSessions)
    setSelectedCoachSessionIds((current) =>
      current.filter((id) => nextSessions.some((session) => session.id === id)),
    )
  }, [coachSessionRange])

  useEffect(() => {
    void refreshCoachSessions()
  }, [refreshCoachSessions])

  useEffect(() => {
    if (!notificationsSupported()) return () => undefined

    const syncPermission = () => {
      void refreshNotificationStatus()
    }

    const onFocus = () => syncPermission()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncPermission()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    let permissionStatus: PermissionStatus | null = null

    if ('permissions' in navigator && typeof navigator.permissions.query === 'function') {
      void navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then((status) => {
          permissionStatus = status
          status.addEventListener('change', syncPermission)
        })
        .catch(() => undefined)
    }

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      permissionStatus?.removeEventListener('change', syncPermission)
    }
  }, [])

  useEffect(() => {
    setMemoryDraft(coachMemory)
  }, [coachMemory])

  const selectedGroups = useMemo(() => getSelectedGroups(clearSelection), [clearSelection])
  const hasSelection = selectedGroups.length > 0

  const handleExport = async () => {
    setIsExporting(true)
    setExportStatus(null)
    try {
      const filename = await downloadAppDataExport()
      setExportStatus(`Backup exportado: ${filename}`)
    } catch (error) {
      console.error('[settings] export backup failed', error)
      setExportStatus('No se pudo exportar. Inténtalo de nuevo en un momento.')
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportAthleteProfile = async () => {
    setIsExportingProfile(true)
    setProfileExportStatus(null)
    try {
      const filename = await downloadAthleteProfileTestExport()
      setProfileExportStatus(`Perfil exportado: ${filename}`)
    } catch (error) {
      console.error('[settings] export athlete profile failed', error)
      setProfileExportStatus('No se pudo exportar el perfil.')
    } finally {
      setIsExportingProfile(false)
    }
  }

  const handleExportBetaQuality = async () => {
    setIsExportingBetaQuality(true)
    setBetaQualityStatus(null)
    try {
      const filename = await downloadBetaQualitySnapshot()
      await refreshBetaQualitySnapshot()
      setBetaQualityStatus(`Reporte beta exportado: ${filename}`)
    } catch (error) {
      console.error('[settings] export beta quality failed', error)
      setBetaQualityStatus('No se pudo exportar el reporte beta.')
    } finally {
      setIsExportingBetaQuality(false)
    }
  }

  const handleResetPlanBuilderUsage = async () => {
    setIsResettingPlanBuilderUsage(true)
    setBetaQualityStatus(null)
    try {
      const deleted = await resetPlanBuilderDailyUsage()
      await refreshBetaQualitySnapshot()
      setBetaQualityStatus(`Plan Builder reiniciado para pruebas: ${deleted} traza(s) local(es) borrada(s).`)
    } catch (error) {
      console.error('[settings] reset plan builder usage failed', error)
      setBetaQualityStatus('No se pudo reiniciar el contador de Plan Builder.')
    } finally {
      setIsResettingPlanBuilderUsage(false)
    }
  }

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setImportStatus(null)
    try {
      const preview = await previewAppDataImportFile(file)
      setPendingImportFile(file)
      setImportPreview(preview)
    } catch (error) {
      console.error('[settings] preview import failed', error)
      setPendingImportFile(null)
      setImportPreview(null)
      setImportStatus('No se pudo leer el backup.')
    }
  }

  const handleConfirmImport = async () => {
    if (!pendingImportFile) return

    setIsImporting(true)
    setImportStatus(null)
    try {
      const result = await importAppDataFromFile(pendingImportFile, importMode)
      await refreshCounts(setDataCounts)
      await loadMemory()
      setClearSelection({ ...EMPTY_CLEAR_SELECTION })
      setClearConfirm(false)
      setClearStatus(null)
      setPendingImportFile(null)
      setImportPreview(null)
      setImportStatus(
        `Backup importado en modo ${result.mode === 'merge' ? 'merge' : 'replace'} (${result.importedAt}): ${result.counts.sessions} sesiones, ${result.counts.dayLogs} check-ins, ${result.counts.weekSummaries} resumenes, ${result.counts.athletes} atletas y ${result.counts.chatMessages} mensajes.`
      )
    } catch (error) {
      console.error('[settings] import backup failed', error)
      setImportStatus('No se pudo importar el backup.')
    } finally {
      setIsImporting(false)
    }
  }

  const handleClearData = async () => {
    if (!hasSelection) return

    setIsClearing(true)
    setClearStatus(null)
    try {
      const currentUser = user
      let remoteOutcome: Awaited<ReturnType<typeof clearSelectedRemoteAppData>> | null = null
      if (currentUser) {
        clearSelectedSyncArtifactsForUser(currentUser.id, clearSelection)
        remoteOutcome = await clearSelectedRemoteAppData(currentUser.id, clearSelection)
      }

      const clearedGroups = await clearSelectedLocalAppData(clearSelection)

      if (currentUser) {
        await runFullSync(currentUser.id)
      }

      await refreshCounts(setDataCounts)
      setClearSelection({ ...EMPTY_CLEAR_SELECTION })
      setClearConfirm(false)
      if (clearSelection.coachMemory) {
        await loadMemory()
      }

      const remoteFailed = remoteOutcome?.failed ?? []
      const remoteTolerated = remoteOutcome?.tolerated ?? []
      const remotePending = remoteOutcome?.pending ?? []
      const baseMessage = currentUser
        ? remotePending.length === 0
          ? `Se eliminaron ${formatGroupList(clearedGroups)} en este dispositivo y en tu cuenta. Tus otros dispositivos se actualizarán automáticamente.`
          : `Se eliminaron ${formatGroupList(clearedGroups)} en este dispositivo. La limpieza de tu cuenta se completará automáticamente cuando vuelva la conexión.`
        : `Se eliminaron ${formatGroupList(clearedGroups)} en este dispositivo.`
      const warnings: string[] = []
      if (showDevTools && remoteFailed.length > 0) {
        warnings.push(`Sigue pendiente en la nube: ${remoteFailed.map((entry) => entry.table).join(', ')}.`)
      }
      if (showDevTools && remoteTolerated.length > 0) {
        warnings.push(`Tablas sin configurar en la nube se ignoraron: ${remoteTolerated.join(', ')}.`)
      }
      if (showDevTools && remotePending.length > 0 && remoteFailed.length === 0) {
        warnings.push(`Pendiente remoto: ${remotePending.join(', ')}.`)
      }
      setClearStatus([baseMessage, ...warnings].join(' '))
    } catch (error) {
      console.error('[settings] selective data wipe failed', error)
      setClearStatus('No se pudieron eliminar los datos seleccionados. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setIsClearing(false)
    }
  }

  const handleRequestNotifications = async () => {
    const result = await requestNotificationPermission()
    setNotifPermission(result)
    refreshNotificationStatus()
  }

  const handleResyncNotifications = async () => {
    const macroWeekCoherence = buildSettingsMacroWeekCoherence(athleteProfile, sessions)
    await refreshTodayNotifications({
      sessions,
      currentWeekSummary,
      macroWeekCoherence,
      todayDayLog: dayLogs[todayIsoKey()],
      athleteProfile,
    })
    refreshNotificationStatus()
  }

  const handleToggleNotificationPreference = async (
    key: keyof NotificationPreferences,
    value: boolean,
  ) => {
    const next = saveNotificationPreferences({ [key]: value })
    setNotificationPreferences(next)
    await handleResyncNotifications()
  }

  const handleDisableAllNotifications = async () => {
    const next = saveNotificationPreferences({
      sessionReminders: false,
      dailyCheckIn: false,
      weeklyPlanning: false,
      coachFollowUp: false,
      loadAlerts: false,
    })
    setNotificationPreferences(next)
    await handleResyncNotifications()
  }

  const handleRetrySync = async () => {
    const { user: currentUser } = useAuthStore.getState()
    if (currentUser) {
      clearSchemaMismatchBlocks()
      await runFullSync(currentUser.id)
    }
  }

  const handleSaveAthleteProfile = async (patch: Partial<Omit<AthleteProfile, 'id' | 'updatedAt'>>) => {
    await saveAthleteProfile(patch)
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 3000)
  }

  const handleWipeAllData = async () => {
    const { user: currentUser } = useAuthStore.getState()

    const firstConfirm = window.confirm(
      currentUser
        ? 'Esto eliminará TODOS tus datos locales y remotos de RallyIQ. Se perderán sesiones, check-ins, chat, proposals y perfil. ¿Quieres continuar?'
        : 'Esto eliminará TODOS los datos locales de RallyIQ en este navegador. No hay sesión activa, así que no se tocará la nube. ¿Quieres continuar?',
    )
    if (!firstConfirm) return

    const typed = window.prompt('Escribe RESET para confirmar el borrado total de la cuenta en este entorno.')
    if (typed !== 'RESET') return

    setIsWipingAllData(true)
    setClearStatus(null)
    setImportStatus(null)
    try {
      if (!currentUser) {
        await clearAllLocalAppData()
        clearAllOnboardingSkipped(undefined)
        await refreshCounts(setDataCounts)
        await loadMemory()
        await loadWeek(currentWeekStartISO())
        setClearSelection({ ...EMPTY_CLEAR_SELECTION })
        setSelectedCoachSessionIds([])
        setCoachSessionStatus(null)
        setClearStatus('Se eliminaron los datos locales de este navegador. La app quedó reiniciada.')
        navigate(ROUTES.ONBOARDING, { replace: true })
        return
      }

      const outcome = await wipeRemoteAndLocalAppData(currentUser.id)
      if (!outcome.completed) {
        console.warn('[settings] full reset did not complete', outcome.pending)
        setClearStatus('No se pudo completar el reinicio total de la cuenta. Tus datos locales no se reiniciaron para evitar inconsistencias.')
        return
      }

      clearAllOnboardingSkipped(currentUser.id)
      await refreshCounts(setDataCounts)
      await loadMemory()
      await loadWeek(currentWeekStartISO())
      setClearSelection({ ...EMPTY_CLEAR_SELECTION })
      setSelectedCoachSessionIds([])
      setCoachSessionStatus(null)

      const baseMessage = 'Se eliminaron los datos locales y se intentó limpiar la nube. La app quedó reiniciada para este usuario.'
      const warnings: string[] = []
      if (showDevTools && outcome.tolerated.length > 0) {
        warnings.push(`Tablas sin configurar en la nube se ignoraron: ${outcome.tolerated.join(', ')}.`)
      }
      setClearStatus([baseMessage, ...warnings].join(' '))
      navigate(ROUTES.ONBOARDING, { replace: true })
    } catch (error) {
      console.error('[settings] full reset failed', error)
      setClearStatus('No se pudo borrar todo el entorno del usuario.')
    } finally {
      setIsWipingAllData(false)
    }
  }

  const handleRestartOnboarding = () => {
    const { user: currentUser } = useAuthStore.getState()
    clearOnboardingSkipped(currentUser?.id)
    navigate(ROUTES.ONBOARDING, { replace: true })
  }

  const applyClearPreset = (selection: LocalDataSelection) => {
    setClearSelection({
      ...EMPTY_CLEAR_SELECTION,
      ...selection,
    })
    setClearConfirm(false)
    setClearStatus(null)
  }

  const sportSummary = getSportPrioritySummary(athleteProfile)
  const enabledSports = getEnabledSports(athleteProfile)
  const profileSyncAffected = syncDetails.pendingTables.includes('athlete_profiles')
  const syncSummary = getSyncSummary(syncStatus, syncDetails.pendingOps, syncDetails.syncAttemptInFlight)
  const syncHeadline = getSyncHeadline(syncStatus, syncDetails.pendingOps, syncDetails.syncAttemptInFlight, profileSyncAffected)
  const syncSupportText = getSyncSupportText(syncStatus, syncDetails.pendingOps, syncDetails.syncAttemptInFlight)
  const syncDiagnosticsAvailable =
    syncDetails.pendingOps > 0 ||
    syncDetails.pendingTables.length > 0 ||
    syncDetails.lastErrorMessage != null ||
    syncDetails.oldestPendingOpAt != null
  const syncErrorNeedsSupport =
    syncDetails.lastErrorCategory === 'schema_mismatch' ||
    syncDetails.lastErrorCategory === 'supabase_not_configured' ||
    syncDetails.lastErrorCategory === 'rls_error'
  const syncErrorMessage = syncErrorNeedsSupport
    ? 'Tus cambios están guardados en este dispositivo. Si esto persiste, contactá soporte.'
    : 'Tus cambios están guardados en este dispositivo y se subirán automáticamente.'

  const toggleCoachSessionSelection = (sessionId: string) => {
    setSelectedCoachSessionIds((current) =>
      current.includes(sessionId) ? current.filter((id) => id !== sessionId) : [...current, sessionId],
    )
    setCoachSessionStatus(null)
  }

  const handleDeleteSelectedCoachSessions = async () => {
    if (selectedCoachSessionIds.length === 0) return
    const confirmed = window.confirm(
      `Se eliminaran ${selectedCoachSessionIds.length} entrenamientos creados por RallyIQ. Esta accion no se puede deshacer.`,
    )
    if (!confirmed) return

    setIsDeletingCoachSessions(true)
    setCoachSessionStatus(null)
    try {
      const deleted = await deleteCoachSessionsByIds(selectedCoachSessionIds)
      await refreshCoachSessions()
      await refreshCounts(setDataCounts)
      await loadWeek(currentWeekStartISO())
      setSelectedCoachSessionIds([])
      setCoachSessionStatus(
        deleted > 0
          ? `Se eliminaron ${deleted} entrenamientos de RallyIQ.`
          : 'No se encontraron entrenamientos de RallyIQ para eliminar.',
      )
    } finally {
      setIsDeletingCoachSessions(false)
    }
  }

  return (
    <div className="px-4 pt-12 pb-8 space-y-5 md:px-6 md:space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink mb-1">Ajustes</h1>
        <p className="text-sm text-ink-muted">Configuracion local, contexto de RallyIQ y mantenimiento.</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5 md:space-y-6">
          <Card className="p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-brand-light" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-ink">Cuenta</h2>
                <p className="text-xs text-ink-muted mt-1 truncate">{user?.email ?? 'Sesion activa'}</p>
              </div>
              <SyncStatusBadge
                status={syncStatus}
                error={syncError}
                pendingOps={syncDetails.pendingOps}
                syncAttemptInFlight={syncDetails.syncAttemptInFlight}
                autoRepairInProgress={syncDetails.autoRepairInProgress}
              />
            </div>
            {syncDetails.autoRepairInProgress && (
              <p className="mb-3 rounded-xl border border-brand/20 bg-brand/10 px-3 py-2 text-xs text-brand-light animate-pulse">
                Estamos actualizando tu perfil. Esto solo toma unos segundos.
              </p>
            )}
            {syncStatus === 'error' && !syncDetails.autoRepairInProgress && (
              <p className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {syncErrorMessage}
                {showDevTools && syncError && (
                  <span className="block mt-1 text-amber-200/80">
                    [{syncDetails.lastErrorCategory ?? 'error'}] {syncError}
                  </span>
                )}
              </p>
            )}
            {showDevTools && (
            <div className="mb-3 rounded-xl border border-surface-border bg-surface-raised px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{syncHeadline}</p>
                  <p className="mt-1 text-xs text-ink-muted leading-relaxed">{syncSupportText}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${syncSummary.toneClass}`}>
                  {syncSummary.label}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-ink-muted sm:grid-cols-2">
                <p>
                  Cola pendiente: <span className="text-ink">{syncDetails.pendingOps}</span>
                </p>
                <p>
                  Ultimo sync OK:{' '}
                  <span className="text-ink">
                    {syncDetails.lastSuccessfulSyncAt ? formatRuntimeTimestamp(syncDetails.lastSuccessfulSyncAt) : 'sin registro'}
                  </span>
                </p>
                {(syncStatus === 'error' || syncStatus === 'offline') && syncDetails.lastSyncAt && (
                  <p>
                    Ultimo intento: <span className="text-ink">{formatRuntimeTimestamp(syncDetails.lastSyncAt)}</span>
                  </p>
                )}
              </div>
              {syncDiagnosticsAvailable && (
                <details className="mt-3 group">
                  <summary className="cursor-pointer list-none text-xs font-medium text-ink-muted transition-colors group-open:text-ink">
                    Ver detalle tecnico
                  </summary>
                  <div className="mt-2 space-y-2 rounded-xl border border-surface-border/80 bg-surface px-3 py-3 text-xs text-ink-muted">
                    <p>
                      Upserts / deletes: <span className="text-ink">{syncDetails.pendingUpserts}/{syncDetails.pendingDeletes}</span>
                    </p>
                    <p>
                      Recovery offline:{' '}
                      <span className="text-ink">
                        {syncDetails.lastRecoveredSyncAt ? formatRuntimeTimestamp(syncDetails.lastRecoveredSyncAt) : 'sin registro'}
                      </span>
                    </p>
                    {syncDetails.oldestPendingOpAt && (
                      <p>
                        Cola mas antigua: <span className="text-ink">{formatRuntimeTimestamp(syncDetails.oldestPendingOpAt)}</span>
                      </p>
                    )}
                    {syncDetails.pendingTables.length > 0 && (
                      <p>
                        Tablas afectadas: <span className="text-ink">{syncDetails.pendingTables.join(', ')}</span>
                      </p>
                    )}
                    {syncDetails.lastBlockedTable && (
                      <p>
                        Tabla bloqueada: <span className="text-ink">{syncDetails.lastBlockedTable}</span>
                      </p>
                    )}
                    {syncDetails.retryScheduledAt && (
                      <p>
                        Proximo retry auto: <span className="text-ink">{formatRuntimeTimestamp(syncDetails.retryScheduledAt)}</span>
                      </p>
                    )}
                    {syncDetails.consecutiveFailures > 0 && (
                      <p>
                        Fallos consecutivos: <span className="text-ink">{syncDetails.consecutiveFailures}</span>
                      </p>
                    )}
                    {syncDetails.lastErrorCategory && (
                      <p>
                        Categoria error: <span className="text-ink">{syncDetails.lastErrorCategory}</span>
                      </p>
                    )}
                    {syncDetails.lastAutoRepairAt && (
                      <p>
                        Ultima reparacion auto: <span className="text-ink">{formatRuntimeTimestamp(syncDetails.lastAutoRepairAt)}</span>
                      </p>
                    )}
                    {syncDetails.lastErrorMessage && (
                      <p className="text-amber-300">
                        Ultimo incidente: {syncDetails.lastErrorMessage}
                      </p>
                    )}
                  </div>
                </details>
              )}
              <SyncDiagnosticsPanel
                tierHealthMap={syncDetails.tierHealthMap}
                refreshToken={syncDetails.lastErrorAt ?? 0}
                userId={user?.id ?? null}
              />
            </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void signOut()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-raised text-ink-muted text-sm font-semibold hover:bg-surface hover:text-ink transition-colors"
              >
                <LogOut size={14} />
                Cerrar sesion
              </button>
              {showDevTools && syncStatus === 'error' && (
                <button
                  onClick={() => void handleRetrySync()}
                  disabled={syncDetails.syncAttemptInFlight}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-raised text-amber-400 text-sm font-semibold hover:bg-surface transition-colors"
                >
                  {syncDetails.syncAttemptInFlight ? 'Reintentando...' : 'Reintentar ahora'}
                </button>
              )}
              {showDevTools && (syncDetails.pendingOps > 0 || syncStatus === 'offline') && syncStatus !== 'error' && (
                <button
                  onClick={() => void handleRetrySync()}
                  disabled={syncDetails.syncAttemptInFlight}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-raised text-brand-light text-sm font-semibold hover:bg-surface transition-colors"
                >
                  {syncDetails.syncAttemptInFlight ? 'Sincronizando...' : 'Reintentar ahora'}
                </button>
              )}
            </div>
          </Card>

          {showDevTools && (
          <Card className="p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0">
                <Brain size={16} className="text-brand-light" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-ink">Debug IA</h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  Ultimas solicitudes de RallyIQ con trace, proveedor, duracion y resultado tecnico.
                </p>
              </div>
              <button
                onClick={() => void refreshBetaQualitySnapshot()}
                className="rounded-xl bg-surface-raised px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              >
                Actualizar
              </button>
            </div>
            <div className="mb-3 rounded-xl border border-surface-border bg-surface-raised px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Beta quality local</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                    Metadata local para revisar estabilidad sin guardar prompts ni respuestas completas.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <button
                    onClick={() => void handleResetPlanBuilderUsage()}
                    disabled={isResettingPlanBuilderUsage}
                    className="inline-flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-xs font-semibold text-brand-light transition-colors hover:bg-surface-border disabled:opacity-60"
                  >
                    <RotateCcw size={13} />
                    {isResettingPlanBuilderUsage ? 'Reiniciando...' : 'Reset Plan Builder'}
                  </button>
                  <button
                    onClick={() => void handleExportBetaQuality()}
                    disabled={isExportingBetaQuality}
                    className="inline-flex items-center gap-2 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-light disabled:opacity-60"
                  >
                    <Download size={13} />
                    {isExportingBetaQuality ? 'Exportando...' : 'Exportar'}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <BetaMetric label="Requests" value={betaQualitySnapshot?.requestCount ?? aiDebugRequests.length} />
                <BetaMetric label="Feedback" value={betaQualitySnapshot?.feedbackCount ?? 0} />
                <BetaMetric label="Positivo" value={betaQualitySnapshot?.positiveFeedback ?? 0} />
                <BetaMetric label="Negativo" value={betaQualitySnapshot?.negativeFeedback ?? 0} />
              </div>
              {betaQualitySnapshot && (
                <div className="mt-3 grid gap-1 text-[11px] text-ink-muted sm:grid-cols-2">
                  {Object.entries(betaQualitySnapshot.dailyLimits).map(([requestClass, limit]) => {
                    const used = betaQualitySnapshot.dailyUsage[requestClass as keyof typeof betaQualitySnapshot.dailyUsage] ?? 0
                    return (
                      <p key={requestClass}>
                        {requestClass}: <span className="text-ink">{used}/{limit}</span>
                      </p>
                    )
                  })}
                </div>
              )}
              {betaQualityStatus && (
                <p className="mt-3 text-xs text-emerald-400">{betaQualityStatus}</p>
              )}
            </div>
            {aiDebugRequests.length === 0 ? (
              <p className="text-xs text-ink-faint">Aun no hay trazas IA en esta sesion.</p>
            ) : (
              <div className="space-y-2">
                {aiDebugRequests.slice(0, 20).map((request) => (
                  <div
                    key={request.traceId}
                    className="rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-xs text-ink-muted"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] text-brand-light">{request.requestClass}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-ink"
                        style={{ background: 'rgba(255,255,255,0.06)' }}>
                        {request.status}
                      </span>
                      {request.outcome && (
                        <span className="rounded-full border border-surface-border px-2 py-0.5 text-[10px] text-ink-faint">
                          {formatAIOutcome(request.outcome)}
                        </span>
                      )}
                      {request.provider && (
                        <span className="text-ink-faint">{request.provider}{request.model ? ` · ${request.model}` : ''}</span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-ink-faint break-all">{request.traceId}</p>
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      <p>Superficie: <span className="text-ink">{request.surface}</span></p>
                      <p>Duracion: <span className="text-ink">{request.durationMs != null ? `${request.durationMs}ms` : 'pendiente'}</span></p>
                      <p>Retry backend/logico: <span className="text-ink">{request.retryUsed ? 'si' : 'no'}</span></p>
                      <p>Fallback: <span className="text-ink">{request.fallbackUsed ? 'si' : 'no'}</span></p>
                      {request.responseCharCount != null && (
                        <p>Respuesta: <span className="text-ink">{request.responseCharCount} chars</span></p>
                      )}
                      {request.actionCount != null && (
                        <p>Acciones: <span className="text-ink">{request.actionCount}</span></p>
                      )}
                      {request.firstChunkAt && (
                        <p>Primer chunk: <span className="text-ink">{formatRuntimeTimestamp(request.firstChunkAt)}</span></p>
                      )}
                      {request.warnings && request.warnings.length > 0 && (
                        <p className="text-amber-300">Warnings: {request.warnings.join(', ')}</p>
                      )}
                      {request.errorCode && (
                        <p className="text-amber-300">Error: {request.errorCode}</p>
                      )}
                      {request.proposalCreated != null && (
                        <p>Proposal: <span className="text-ink">{request.proposalCreated ? 'creada' : 'no creada'}</span></p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          )}

          <Card className="p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0">
                <Brain size={16} className="text-brand-light" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">Memoria de RallyIQ</h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  Datos persistentes que RallyIQ debe considerar siempre: lesiones, preferencias, torneos o restricciones.
                </p>
              </div>
            </div>
            <textarea
              value={memoryDraft}
              onChange={(e) => setMemoryDraft(e.target.value)}
              rows={5}
              placeholder="Ej: molestia rodilla derecha desde febrero, evitar fuerza pesada el dia antes de partido, proximo torneo en mayo..."
              className="w-full rounded-xl bg-surface-raised border border-surface-border px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint resize-none focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
            <div className="mt-3 flex items-center justify-end gap-3">
              {memorySaved && (
                <span className="text-xs text-emerald-400 font-medium">Memoria guardada</span>
              )}
              <button
                onClick={() => {
                  void saveMemory(memoryDraft).then(() => {
                    setMemorySaved(true)
                    setTimeout(() => setMemorySaved(false), 3000)
                  })
                }}
                disabled={isSaving}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? 'Guardando...' : 'Guardar memoria'}
              </button>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-brand-light" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">Perfil del atleta</h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  Datos estructurados para que RallyIQ proponga ritmos, cargas y semanas más precisos.
                </p>
              </div>
            </div>
            {enabledSports.length > 0 && (
              <div className="mb-4 rounded-xl border border-surface-border bg-surface-raised px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Resumen deportivo</p>
                <p className="mt-1 text-sm text-ink">{sportSummary || `${enabledSports.length} deportes configurados`}</p>
              </div>
            )}
            {profileSaved && (
              <p className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300">
                Perfil guardado. RallyIQ usará estos cambios en la próxima respuesta.
              </p>
            )}
            <AthleteProfileEditor
              key={athleteProfile?.updatedAt ?? 'athlete-profile-empty'}
              profile={athleteProfile}
              isSaving={isSaving}
              onSave={handleSaveAthleteProfile}
            />
            <div className="mt-4 rounded-xl border border-surface-border bg-surface-raised px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">Export de pruebas del perfil</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                    Incluye perfil deportivo, disponibilidad, ritmos, cargas, evento objetivo y plan activo.
                  </p>
                </div>
                <button
                  onClick={() => void handleExportAthleteProfile()}
                  disabled={isExportingProfile}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-surface px-3 py-2 text-xs font-semibold text-brand-light transition-colors hover:bg-surface-border disabled:opacity-60"
                >
                  <Download size={13} />
                  {isExportingProfile ? 'Exportando...' : 'Exportar perfil'}
                </button>
              </div>
              {profileExportStatus && (
                <p className="mt-3 text-xs text-emerald-400">{profileExportStatus}</p>
              )}
            </div>
            <div className="mt-4 rounded-xl border border-surface-border bg-surface-raised px-3 py-3">
              <p className="text-xs text-ink-muted leading-relaxed">
                Si quieres volver a la configuración guiada sin borrar toda la cuenta, puedes relanzar el onboarding.
              </p>
              <button
                onClick={handleRestartOnboarding}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm font-semibold text-brand-light transition-colors hover:bg-surface-border"
              >
                Reiniciar onboarding
              </button>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-ink">Backup JSON</h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  Exporta o restaura sesiones, check-ins, resumenes semanales, chat, proposals y memoria de RallyIQ.
                </p>
              </div>
              <div className="flex w-full flex-col sm:w-auto sm:flex-row gap-2">
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void handleImportFile(event)}
                  className="hidden"
                />
                <button
                  onClick={() => importInputRef.current?.click()}
                  disabled={isImporting}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-surface-raised text-ink text-sm font-semibold hover:bg-surface transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Upload size={14} />
                  {isImporting ? 'Importando...' : 'Seleccionar backup'}
                </button>
                <button
                  onClick={() => void handleExport()}
                  disabled={isExporting}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  <Download size={14} />
                  {isExporting ? 'Exportando...' : 'Exportar'}
                </button>
              </div>
            </div>
            {exportStatus && (
              <p className="text-xs text-ink-muted mt-3">{exportStatus}</p>
            )}
            {importStatus && (
              <p className={`text-xs mt-2 ${importStatus.startsWith('Backup importado') ? 'text-emerald-400' : 'text-amber-400'}`}>
                {importStatus}
              </p>
            )}
            {importPreview && (
              <div className="mt-4 rounded-2xl border border-surface-border bg-surface-raised px-4 py-3 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-ink">Preview del backup</p>
                    <p className="text-xs text-ink-muted mt-1">
                      Exportado el {formatBackupDate(importPreview.importedAt)} · app {importPreview.importedFromAppVersion} · formato v{importPreview.version}
                    </p>
                    {importPreview.sessionDateRange && (
                      <p className="text-xs text-ink-faint mt-0.5">
                        Sesiones: {importPreview.sessionDateRange.first} → {importPreview.sessionDateRange.last}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setImportPreview(null)
                      setPendingImportFile(null)
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-semibold text-ink-muted hover:bg-surface transition-colors"
                  >
                    Cancelar
                  </button>
                </div>

                <div className="rounded-xl border border-surface-border overflow-hidden">
                  <div className="grid grid-cols-3 text-[10px] font-medium text-ink-faint uppercase tracking-wider px-3 py-1.5 bg-surface border-b border-surface-border">
                    <span>Dato</span>
                    <span className="text-center">Backup</span>
                    <span className="text-center">Local</span>
                  </div>
                  {[
                    { label: 'Sesiones', backup: importPreview.counts.sessions, local: dataCounts?.trainingData.sessions },
                    { label: 'Check-ins', backup: importPreview.counts.dayLogs, local: dataCounts?.trainingData.dayLogs },
                    { label: 'Resúmenes', backup: importPreview.counts.weekSummaries, local: dataCounts?.trainingData.weekSummaries },
                    { label: 'Atletas', backup: importPreview.counts.athletes, local: dataCounts?.trainingData.athletes },
                    { label: 'Mensajes', backup: importPreview.counts.chatMessages, local: dataCounts?.chatHistory },
                    { label: 'Proposals', backup: importPreview.counts.coachProposals, local: null },
                  ].map(row => (
                    <div key={row.label} className="grid grid-cols-3 text-xs px-3 py-1.5 border-b border-surface-border/50 last:border-0">
                      <span className="text-ink-muted">{row.label}</span>
                      <span className="text-center font-medium text-ink">{row.backup}</span>
                      <span className="text-center text-ink-faint">{row.local ?? '—'}</span>
                    </div>
                  ))}
                </div>

                {importMode === 'merge' && (() => {
                  const c = importPreview.mergeConflicts
                  const hasConflicts = c.localNewerCount > 0 || c.backupNewerCount > 0 || c.newInBackupCount > 0
                  return (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 space-y-1">
                      <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Resultado estimado del merge</p>
                      {!hasConflicts ? (
                        <p className="text-xs text-ink-muted">Sin diferencias — backup y datos locales son idénticos.</p>
                      ) : (
                        <ul className="space-y-0.5 text-xs text-ink-muted">
                          {c.newInBackupCount > 0 && (
                            <li><span className="text-emerald-400 font-medium">{c.newInBackupCount}</span> registros nuevos se añadirán</li>
                          )}
                          {c.backupNewerCount > 0 && (
                            <li><span className="text-amber-400 font-medium">{c.backupNewerCount}</span> registros más nuevos en backup sobreescribirán los locales</li>
                          )}
                          {c.localNewerCount > 0 && (
                            <li><span className="text-ink font-medium">{c.localNewerCount}</span> registros locales más nuevos se conservarán</li>
                          )}
                        </ul>
                      )}
                    </div>
                  )
                })()}

                <div className="space-y-2">
                  <p className="text-xs font-medium text-ink">Modo de restauracion</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      onClick={() => setImportMode('replace')}
                      className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                        importMode === 'replace'
                          ? 'border-amber-500/40 bg-amber-500/10'
                          : 'border-surface-border bg-surface'
                      }`}
                    >
                      <p className="text-sm font-semibold text-ink">Replace</p>
                      <p className="text-xs text-ink-muted mt-1">Borra lo local actual y deja exactamente el contenido del backup.</p>
                    </button>
                    <button
                      onClick={() => setImportMode('merge')}
                      className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                        importMode === 'merge'
                          ? 'border-emerald-500/40 bg-emerald-500/10'
                          : 'border-surface-border bg-surface'
                      }`}
                    >
                      <p className="text-sm font-semibold text-ink">Merge</p>
                      <p className="text-xs text-ink-muted mt-1">Inserta o actualiza por ID sin vaciar primero la base local.</p>
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => void handleConfirmImport()}
                    disabled={isImporting}
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    <Upload size={14} />
                    {isImporting ? 'Importando...' : `Importar en modo ${importMode}`}
                  </button>
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5 md:space-y-6">
          <Card className="p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0">
                <Bell size={16} className="text-brand-light" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">Notificaciones y activacion</h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  Recordatorios de sesion, cierre del dia y nudges semanales para no perder continuidad.
                </p>
              </div>
            </div>
            {!notificationsSupported() ? (
              <p className="text-xs text-ink-muted">Notificaciones no disponibles en este navegador.</p>
            ) : notifPermission === 'granted' ? (
              <div className="space-y-2">
                <p className="text-xs text-emerald-400 font-medium">Notificaciones activadas</p>
                <div className="rounded-xl border border-surface-border bg-surface-raised px-3 py-3 space-y-3">
                  <p className="text-[11px] uppercase tracking-wide text-ink-faint">Categorias activas</p>
                  <div className="space-y-2">
                    <NotificationPreferenceRow
                      label="Sesiones del dia"
                      description="Aviso 30 min antes de cada sesion planificada."
                      checked={notificationPreferences.sessionReminders}
                      onChange={(checked) => void handleToggleNotificationPreference('sessionReminders', checked)}
                    />
                    <NotificationPreferenceRow
                      label="Check-in y feedback"
                      description="Nudge para cerrar el dia o completar feedback de sesion."
                      checked={notificationPreferences.dailyCheckIn}
                      onChange={(checked) => void handleToggleNotificationPreference('dailyCheckIn', checked)}
                    />
                    <NotificationPreferenceRow
                      label="Semana vacia"
                      description="Aviso cuando aun no hay plan para la semana."
                      checked={notificationPreferences.weeklyPlanning}
                      onChange={(checked) => void handleToggleNotificationPreference('weeklyPlanning', checked)}
                    />
                    <NotificationPreferenceRow
                      label="Follow-up de RallyIQ"
                      description="Recuerda generar o revisar la nota semanal."
                      checked={notificationPreferences.coachFollowUp}
                      onChange={(checked) => void handleToggleNotificationPreference('coachFollowUp', checked)}
                    />
                    <NotificationPreferenceRow
                      label="Alertas de carga"
                      description="Avisos cuando la semana queda incoherente con el bloque."
                      checked={notificationPreferences.loadAlerts}
                      onChange={(checked) => void handleToggleNotificationPreference('loadAlerts', checked)}
                    />
                  </div>
                  <div className="pt-1">
                    <button
                      onClick={() => void handleDisableAllNotifications()}
                      className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink-muted transition-colors"
                    >
                      Desactivar todas las notificaciones
                    </button>
                  </div>
                </div>
              </div>
            ) : notifPermission === 'denied' ? (
              <div className="space-y-2">
                <p className="text-xs text-amber-400 leading-relaxed">
                  Permiso bloqueado. Activalas desde los ajustes del navegador para este sitio.
                </p>
                <button
                  onClick={() => void refreshNotificationStatus()}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-raised text-ink text-sm font-semibold hover:bg-surface transition-colors"
                >
                  Revisar permiso
                </button>
              </div>
            ) : (
              <button
                onClick={() => void handleRequestNotifications()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-light transition-colors"
              >
                <Bell size={14} />
                Activar notificaciones
              </button>
            )}
          </Card>

          <Card className="p-4 border-amber-500/20">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <Trash2 size={16} className="text-amber-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">Entrenamientos de RallyIQ</h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  Elimina sesiones creadas por RallyIQ sin borrar todo el bloque de entrenamiento.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <label className="text-xs text-ink-muted">
                Rango reciente
                <select
                  value={coachSessionRange}
                  onChange={(e) => setCoachSessionRange(Number(e.target.value) as 1 | 2 | 3 | 4)}
                  className="ml-2 rounded-lg border border-surface-border bg-surface-raised px-2 py-1 text-xs text-ink"
                >
                  <option value={1}>Ultima semana</option>
                  <option value={2}>Ultimas 2 semanas</option>
                  <option value={3}>Ultimas 3 semanas</option>
                  <option value={4}>Ultimas 4 semanas</option>
                </select>
              </label>

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setSelectedCoachSessionIds(coachSessions.map((session) => session.id))}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-ink hover:bg-surface transition-colors"
                >
                  Seleccionar visibles
                </button>
                <button
                  onClick={() => setSelectedCoachSessionIds([])}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-ink-muted hover:bg-surface transition-colors"
                >
                  Limpiar
                </button>
              </div>
            </div>

            {coachSessions.length === 0 ? (
              <p className="text-xs text-ink-muted">No hay entrenamientos de RallyIQ en este rango.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {coachSessions.map((session) => {
                  const selected = selectedCoachSessionIds.includes(session.id)
                  return (
                    <label
                      key={session.id}
                      className={`flex items-start gap-3 rounded-xl border px-3 py-2 transition-colors ${
                        selected
                          ? 'border-amber-500/40 bg-amber-500/10'
                          : 'border-surface-border bg-surface-raised'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleCoachSessionSelection(session.id)}
                        className="mt-1 h-4 w-4 rounded border-surface-border bg-surface"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink">{session.title}</p>
                            <p className="text-xs text-ink-muted mt-1">
                              {session.date} · {session.timeBlock} · {session.type}
                            </p>
                          </div>
                          <span className="text-[11px] font-medium text-amber-400">RallyIQ</span>
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}

            {coachSessionStatus && (
              <p className="mt-3 text-xs text-emerald-400">{coachSessionStatus}</p>
            )}

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => void handleDeleteSelectedCoachSessions()}
                disabled={isDeletingCoachSessions || selectedCoachSessionIds.length === 0}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 text-amber-400 text-sm font-semibold hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 size={14} />
                {isDeletingCoachSessions
                  ? 'Eliminando...'
                  : selectedCoachSessionIds.length > 0
                    ? `Eliminar ${selectedCoachSessionIds.length}`
                    : 'Selecciona sesiones'}
              </button>
            </div>
          </Card>

          <Card className="p-4 border-red-500/20">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <ShieldAlert size={16} className="text-red-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">Limpiar datos</h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  {user
                    ? 'Elige exactamente que quieres borrar. Si confirmas, se eliminara de este dispositivo y de tu cuenta para que tambien desaparezca del resto de tus dispositivos.'
                    : 'Elige exactamente que quieres borrar en este dispositivo. Los bloques estan agrupados para evitar datos huerfanos.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => applyClearPreset({
                  trainingData: true,
                  chatHistory: true,
                  coachProposals: true,
                  coachMemory: true,
                })}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-ink hover:bg-surface-raised transition-colors"
              >
                Seleccionar todo
              </button>
              <button
                onClick={() => applyClearPreset({ trainingData: true })}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-ink hover:bg-surface-raised transition-colors"
              >
                Solo entrenamiento
              </button>
              <button
                onClick={() => applyClearPreset({ chatHistory: true, coachProposals: true })}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-ink hover:bg-surface-raised transition-colors"
              >
                Solo RallyIQ
              </button>
              <button
                onClick={() => applyClearPreset({})}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-ink-muted hover:bg-surface-raised transition-colors"
              >
                Limpiar seleccion
              </button>
            </div>

            <div className="space-y-2">
              {CLEARABLE_GROUPS.map((group) => {
                const selected = Boolean(clearSelection[group.key])

                return (
                  <label
                    key={group.key}
                    className={`block w-full cursor-pointer rounded-2xl border px-3 py-3 transition-colors ${
                      selected
                        ? 'border-red-500/40 bg-red-500/10'
                        : 'border-surface-border bg-surface-raised hover:border-red-500/20'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => {
                          setClearSelection((current) => ({
                            ...current,
                            [group.key]: !current[group.key],
                          }))
                          setClearConfirm(false)
                          setClearStatus(null)
                        }}
                        className="mt-1 h-4 w-4 rounded border-surface-border bg-surface"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink">{group.title}</p>
                            <p className="text-xs text-ink-muted mt-1">{group.description}</p>
                          </div>
                          <span className="text-[11px] font-medium text-ink-muted whitespace-nowrap">
                            {formatCountLabel(group.key, dataCounts)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>

            {clearStatus && (
              <p
                className={`mt-3 text-xs ${
                  clearStatus.includes('No se pudo') || clearStatus.includes('No se borraron')
                    ? 'text-red-400'
                    : 'text-emerald-400'
                }`}
              >
                {clearStatus}
              </p>
            )}

            {!clearConfirm ? (
              <button
                onClick={() => setClearConfirm(true)}
                disabled={!hasSelection}
                className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 text-red-400 text-sm font-semibold hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 size={14} />
                {hasSelection ? 'Continuar con eliminacion' : 'Selecciona algo para borrar'}
              </button>
            ) : (
              <div className="space-y-3 mt-4">
                <p className="text-xs text-ink-muted leading-relaxed">
                  Esta accion no se puede deshacer. Se borrara: <span className="text-ink">{formatGroupList(selectedGroups)}</span>.
                  {user
                    ? ' Tambien se eliminara de tu cuenta para que se limpie en tus otros dispositivos.'
                    : ''}
                  {' '}Si quieres conservar algo, exporta un backup antes.
                </p>
                <div className="flex gap-2 justify-end flex-wrap">
                  <button
                    onClick={() => setClearConfirm(false)}
                    className="px-3 py-2 rounded-xl text-sm text-ink-muted hover:bg-surface-raised transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => void handleClearData()}
                    disabled={isClearing || !hasSelection}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/20 text-red-400 text-sm font-semibold hover:bg-red-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    <Trash2 size={14} />
                    {isClearing ? 'Eliminando datos...' : 'Confirmar eliminacion'}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <ShieldAlert size={16} className="text-red-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">Reset total del usuario</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                    Usa esto solo si quieres dejar la app desde cero. Borra datos locales y también los datos remotos para que no vuelvan a aparecer al sincronizar en PC o celular.
                  </p>
                  <button
                    onClick={() => void handleWipeAllData()}
                    disabled={isWipingAllData}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} />
                    {isWipingAllData ? 'Borrando todo...' : 'Borrar local + nube'}
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function NotificationPreferenceRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-xl border border-white/5 bg-surface px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-surface-border bg-surface"
      />
    </label>
  )
}

function BetaMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/5 bg-surface px-2.5 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-ink">{value}</p>
    </div>
  )
}

function formatAIOutcome(outcome: NonNullable<AITechnicalResult['outcome']>): string {
  switch (outcome) {
    case 'ok':
      return 'ok'
    case 'truncated_mid':
      return 'truncada parcial'
    case 'truncated_early':
      return 'truncada temprano'
    case 'parse_invalid':
      return 'parse invalido'
    case 'schema_invalid':
      return 'schema invalido'
  }
}

async function refreshCounts(setDataCounts: (counts: LocalDataCounts) => void): Promise<void> {
  const counts = await getLocalDataCounts()
  setDataCounts(counts)
}

function getSelectedGroups(selection: LocalDataSelection): LocalDataGroup[] {
  return CLEARABLE_GROUPS
    .map((group) => group.key)
    .filter((key) => Boolean(selection[key]))
}

function formatCountLabel(group: LocalDataGroup, counts: LocalDataCounts | null): string {
  if (!counts) return 'Cargando...'

  switch (group) {
    case 'trainingData': {
      const { sessions, dayLogs, weekSummaries, athletes } = counts.trainingData
      return `${sessions} sesiones - ${dayLogs} check-ins - ${weekSummaries} resumenes - ${athletes} atletas`
    }
    case 'chatHistory':
      return `${counts.chatHistory} mensajes`
    case 'coachProposals':
      return `${counts.coachProposals} proposals`
    case 'coachMemory':
      return counts.coachMemory > 0 ? 'Guardada' : 'Vacia'
  }
}

function buildSettingsMacroWeekCoherence(athleteProfile: AthleteProfile | null | undefined, sessions: Session[]) {
  return buildMacroWeekCoherenceSummary({
    athleteProfile,
    sessions,
    historicalSessions: sessions.filter((session) => session.status === 'completed' || session.status === 'adjusted'),
  })
}

function todayIsoKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function getSyncSummary(status: string, pendingOps: number, syncAttemptInFlight: boolean): { label: string; toneClass: string } {
  if (status === 'error') {
    return {
      label: pendingOps > 0 ? `${pendingOps} pendiente${pendingOps === 1 ? '' : 's'}` : 'Revisar',
      toneClass: 'bg-amber-500/10 text-amber-300',
    }
  }

  if (status === 'offline') {
    return {
      label: pendingOps > 0 ? `Offline ${pendingOps}` : 'Offline',
      toneClass: 'bg-surface text-ink-muted',
    }
  }

  if (status === 'syncing' || syncAttemptInFlight) {
    return {
      label: 'Enviando',
      toneClass: 'bg-brand/10 text-brand-light',
    }
  }

  if (pendingOps > 0) {
    return {
      label: `${pendingOps} pendiente${pendingOps === 1 ? '' : 's'}`,
      toneClass: 'bg-amber-500/10 text-amber-200',
    }
  }

  return {
    label: 'OK',
    toneClass: 'bg-emerald-500/10 text-emerald-300',
  }
}

function getSyncHeadline(status: string, pendingOps: number, syncAttemptInFlight: boolean, profileSyncAffected: boolean): string {
  if (status === 'error') {
    return profileSyncAffected
      ? 'Tu perfil no se pudo actualizar en la nube'
      : 'Hay cambios que no se pudieron sincronizar'
  }

  if (status === 'offline') {
    return pendingOps > 0 ? 'Hay cambios guardados esperando conexion' : 'La app esta offline'
  }

  if (status === 'syncing' || syncAttemptInFlight) {
    return 'Estamos enviando tus cambios'
  }

  if (pendingOps > 0) {
    return 'Quedaron cambios pendientes por subir'
  }

  return 'Cuenta conectada y al dia'
}

function getSyncSupportText(status: string, pendingOps: number, syncAttemptInFlight: boolean): string {
  if (status === 'error') {
    return 'Tus cambios siguen guardados en este dispositivo. Se reintentará automáticamente.'
  }

  if (status === 'offline') {
    return pendingOps > 0
      ? 'La app subira estos cambios automaticamente cuando vuelva la conexion.'
      : 'Puedes seguir usando la app; sincronizara cuando recuperes conexion.'
  }

  if (status === 'syncing' || syncAttemptInFlight) {
    return 'Tus cambios ya quedaron guardados aqui y se estan enviando a la nube.'
  }

  if (pendingOps > 0) {
    return 'Tus cambios siguen guardados localmente. Se subirán en el próximo intento.'
  }

  return 'Tu cuenta, perfil y planificacion estan sincronizados.'
}

function formatBackupDate(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(isoString))
  } catch {
    return isoString
  }
}

function formatRuntimeTimestamp(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp))
  } catch {
    return String(timestamp)
  }
}

function formatGroupList(groups: LocalDataGroup[]): string {
  if (groups.length === 0) return 'nada'

  const labels = groups.map((group) => {
    switch (group) {
      case 'trainingData':
        return 'entrenamiento'
      case 'chatHistory':
        return 'chat'
      case 'coachProposals':
        return 'proposals'
      case 'coachMemory':
        return 'memoria de RallyIQ'
    }
  })

  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} y ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`
}
