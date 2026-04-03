import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Brain, Cpu, Download, LogOut, ShieldAlert, Trash2, Upload, User } from 'lucide-react'
import Card from '../components/ui/Card'
import SyncStatusBadge from '../components/sync/SyncStatusBadge'
import { APP_INFO } from '../constants/appInfo'
import { CoachEngine } from '../services/ai/CoachEngine'
import {
  downloadAppDataExport,
  importAppDataFromFile,
  previewAppDataImportFile,
  type AppDataImportPreview,
} from '../services/dataExport'
import {
  clearSelectedLocalAppData,
  getLocalDataCounts,
  type LocalDataCounts,
  type LocalDataGroup,
  type LocalDataSelection,
} from '../services/appMaintenance'
import {
  getNotificationDebugState,
  getNotificationPermission,
  notificationsSupported,
  requestNotificationPermission,
  type NotificationDebugState,
} from '../services/notifications'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { useAuthStore } from '../store/useAuthStore'

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
    title: 'Chat del coach',
    description: 'Conversaciones guardadas del coach actual y anteriores.',
  },
  {
    key: 'coachProposals',
    title: 'Proposals del coach',
    description: 'Propuestas pendientes, aceptadas o rechazadas.',
  },
  {
    key: 'coachMemory',
    title: 'Memoria del coach',
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
  const { coachMemory, isSaving, loadMemory, saveMemory } = useCoachMemoryStore()
  const { user, signOut, syncStatus, syncError } = useAuthStore()
  const [memoryDraft, setMemoryDraft] = useState('')
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null)
  const [notificationDebugState, setNotificationDebugState] = useState<NotificationDebugState | null>(null)
  const [dataCounts, setDataCounts] = useState<LocalDataCounts | null>(null)
  const [clearSelection, setClearSelection] = useState<LocalDataSelection>(EMPTY_CLEAR_SELECTION)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [clearStatus, setClearStatus] = useState<string | null>(null)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [importPreview, setImportPreview] = useState<AppDataImportPreview | null>(null)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace')
  const importInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void loadMemory()
    setNotifPermission(getNotificationPermission())
    void refreshCounts(setDataCounts)
    void refreshNotificationDebugState(setNotificationDebugState)
  }, [loadMemory])

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
      setExportStatus(error instanceof Error ? error.message : 'No se pudo exportar el backup.')
    } finally {
      setIsExporting(false)
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
      setPendingImportFile(null)
      setImportPreview(null)
      setImportStatus(error instanceof Error ? error.message : 'No se pudo leer el backup.')
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
      await refreshNotificationDebugState(setNotificationDebugState)
      setClearSelection({ ...EMPTY_CLEAR_SELECTION })
      setClearConfirm(false)
      setClearStatus(null)
      setPendingImportFile(null)
      setImportPreview(null)
      setImportStatus(
        `Backup importado en modo ${result.mode === 'merge' ? 'merge' : 'replace'} (${result.importedAt}): ${result.counts.sessions} sesiones, ${result.counts.dayLogs} check-ins, ${result.counts.weekSummaries} resumenes y ${result.counts.chatMessages} mensajes.`
      )
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'No se pudo importar el backup.')
    } finally {
      setIsImporting(false)
    }
  }

  const handleClearData = async () => {
    if (!hasSelection) return

    setIsClearing(true)
    setClearStatus(null)
    try {
      const clearedGroups = await clearSelectedLocalAppData(clearSelection)
      await refreshCounts(setDataCounts)
      setClearSelection({ ...EMPTY_CLEAR_SELECTION })
      setClearConfirm(false)
      if (clearSelection.coachMemory) {
        await loadMemory()
      }
      setClearStatus(`Se elimino: ${formatGroupList(clearedGroups)}.`)
    } finally {
      setIsClearing(false)
    }
  }

  const handleRequestNotifications = async () => {
    const result = await requestNotificationPermission()
    setNotifPermission(result)
    await refreshNotificationDebugState(setNotificationDebugState)
  }

  const applyClearPreset = (selection: LocalDataSelection) => {
    setClearSelection({
      ...EMPTY_CLEAR_SELECTION,
      ...selection,
    })
    setClearConfirm(false)
    setClearStatus(null)
  }

  const providerName = CoachEngine.getProviderName()
  const providerConfigured = CoachEngine.isRealProviderConfigured()

  return (
    <div className="px-4 pt-12 pb-8 space-y-5 md:px-6 md:space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink mb-1">Ajustes</h1>
        <p className="text-sm text-ink-muted">Configuracion local, contexto del coach y mantenimiento.</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5 md:space-y-6">
          <Card className="p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-brand-light" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-ink">Cuenta y sincronizacion</h2>
                <p className="text-xs text-ink-muted mt-1 truncate">{user?.email ?? 'Sesion activa'}</p>
              </div>
              <SyncStatusBadge status={syncStatus} error={syncError} />
            </div>
            <button
              onClick={() => void signOut()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-raised text-ink-muted text-sm font-semibold hover:bg-surface hover:text-ink transition-colors"
            >
              <LogOut size={14} />
              Cerrar sesion
            </button>
          </Card>

          <Card className="p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0">
                <Brain size={16} className="text-brand-light" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">Memoria del coach</h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  Datos persistentes que el coach debe considerar siempre: lesiones, preferencias, torneos o restricciones.
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
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => void saveMemory(memoryDraft)}
                disabled={isSaving}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? 'Guardando...' : 'Guardar memoria'}
              </button>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-ink">Backup JSON</h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  Exporta o restaura sesiones, check-ins, resumenes semanales, chat, proposals y memoria del coach.
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
                      Exportado el {importPreview.importedAt} · app {importPreview.importedFromAppVersion} · formato v{importPreview.version}
                    </p>
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

                <div className="grid gap-2 sm:grid-cols-2 text-xs text-ink-muted">
                  <p>{importPreview.counts.sessions} sesiones</p>
                  <p>{importPreview.counts.dayLogs} check-ins</p>
                  <p>{importPreview.counts.weekSummaries} resumenes</p>
                  <p>{importPreview.counts.chatMessages} mensajes</p>
                  <p>{importPreview.counts.coachProposals} proposals</p>
                  <p>{importPreview.counts.athleteProfiles} perfiles</p>
                </div>

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
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <Cpu size={16} className="text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">Informacion de la app</h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  Estado actual del runtime local.
                </p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-muted">Version</span>
                <span className="text-ink font-medium">{APP_INFO.version}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-muted">Provider AI</span>
                <span className="text-ink font-medium">{providerName}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-muted">Modo AI</span>
                <span className={`font-medium ${providerConfigured ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {providerConfigured ? 'Real' : 'Demo'}
                </span>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0">
                <Bell size={16} className="text-brand-light" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">Notificaciones de sesion</h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  Recibe una notificacion 30 minutos antes de cada sesion del dia.
                  Sesiones AM a las 7:30 h y sesiones PM a las 17:30 h.
                </p>
              </div>
            </div>
            {!notificationsSupported() ? (
              <p className="text-xs text-ink-muted">Notificaciones no disponibles en este navegador.</p>
            ) : notifPermission === 'granted' ? (
              <div className="space-y-2">
                <p className="text-xs text-emerald-400 font-medium">Notificaciones activadas</p>
                {notificationDebugState && (
                  <div className="rounded-xl border border-surface-border bg-surface-raised px-3 py-3 space-y-2">
                    <p className="text-[11px] uppercase tracking-wide text-ink-faint">Estado de hoy ({notificationDebugState.date})</p>
                    <div className="grid gap-2 sm:grid-cols-2 text-xs text-ink-muted">
                      <p>Programadas: <span className="text-ink">{notificationDebugState.scheduledCount}</span></p>
                      <p>Pendientes: <span className="text-ink">{notificationDebugState.pendingCount}</span></p>
                      <p>Enviadas: <span className="text-ink">{notificationDebugState.sentCount}</span></p>
                      <p>Recuperadas: <span className="text-ink">{notificationDebugState.recoveredCount}</span></p>
                    </div>
                    <p className="text-[11px] text-ink-faint">
                      Si la app o el worker vuelven tarde, intenta recuperar avisos dentro de una ventana de {notificationDebugState.graceMinutes} min.
                    </p>
                  </div>
                )}
              </div>
            ) : notifPermission === 'denied' ? (
              <p className="text-xs text-amber-400 leading-relaxed">
                Permiso bloqueado. Activalas desde los ajustes del navegador para este sitio.
              </p>
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

          <Card className="p-4 border-red-500/20">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <ShieldAlert size={16} className="text-red-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">Limpiar datos locales</h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  Elige exactamente que quieres borrar. Los bloques estan agrupados para evitar datos huerfanos.
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
                Solo coach
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
              <p className="text-xs text-emerald-400 mt-3">{clearStatus}</p>
            )}

            {!clearConfirm ? (
              <button
                onClick={() => setClearConfirm(true)}
                disabled={!hasSelection}
                className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 text-red-400 text-sm font-semibold hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 size={14} />
                {hasSelection ? 'Continuar con borrado' : 'Selecciona algo para borrar'}
              </button>
            ) : (
              <div className="space-y-3 mt-4">
                <p className="text-xs text-ink-muted leading-relaxed">
                  Esta accion no se puede deshacer. Se borrara: <span className="text-ink">{formatGroupList(selectedGroups)}</span>.
                  Si quieres conservar algo, exporta un backup antes.
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
                    {isClearing ? 'Borrando...' : 'Confirmar borrado'}
                  </button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

async function refreshCounts(setDataCounts: (counts: LocalDataCounts) => void): Promise<void> {
  const counts = await getLocalDataCounts()
  setDataCounts(counts)
}

async function refreshNotificationDebugState(
  setNotificationDebug: (state: NotificationDebugState | null) => void,
): Promise<void> {
  const state = await getNotificationDebugState()
  setNotificationDebug(state)
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
      const { sessions, dayLogs, weekSummaries } = counts.trainingData
      return `${sessions} sesiones - ${dayLogs} check-ins - ${weekSummaries} resumenes`
    }
    case 'chatHistory':
      return `${counts.chatHistory} mensajes`
    case 'coachProposals':
      return `${counts.coachProposals} proposals`
    case 'coachMemory':
      return counts.coachMemory > 0 ? 'Guardada' : 'Vacia'
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
        return 'memoria del coach'
    }
  })

  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} y ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`
}
