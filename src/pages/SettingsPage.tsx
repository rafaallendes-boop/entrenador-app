import { useEffect, useState } from 'react'
import { Download, Brain, Trash2, Cpu, ShieldAlert, Bell } from 'lucide-react'
import {
  notificationsSupported,
  getNotificationPermission,
  requestNotificationPermission,
} from '../services/notifications'
import Card from '../components/ui/Card'
import { downloadAppDataExport } from '../services/dataExport'
import { clearAllLocalAppData } from '../services/appMaintenance'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { CoachEngine } from '../services/ai/CoachEngine'
import { APP_INFO } from '../constants/appInfo'

export default function SettingsPage() {
  const { coachMemory, isSaving, loadMemory, saveMemory } = useCoachMemoryStore()
  const [memoryDraft, setMemoryDraft] = useState('')
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [clearConfirm, setClearConfirm] = useState(false)

  useEffect(() => {
    void loadMemory()
    setNotifPermission(getNotificationPermission())
  }, [loadMemory])

  useEffect(() => {
    setMemoryDraft(coachMemory)
  }, [coachMemory])

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

  const handleClearData = async () => {
    setIsClearing(true)
    try {
      await clearAllLocalAppData()
      window.location.reload()
    } finally {
      setIsClearing(false)
    }
  }

  const handleRequestNotifications = async () => {
    const result = await requestNotificationPermission()
    setNotifPermission(result)
  }

  const providerName = CoachEngine.getProviderName()
  const providerConfigured = CoachEngine.isRealProviderConfigured()

  return (
    <div className="px-4 pt-12 pb-8 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink mb-1">Ajustes</h1>
        <p className="text-sm text-ink-muted">Configuración local, contexto del coach y mantenimiento</p>
      </div>

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
          placeholder="Ej: molestia rodilla derecha desde febrero, evitar fuerza pesada el día antes de partido, próximo torneo en mayo..."
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Backup JSON</h2>
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">
              Exporta sesiones, check-ins, resúmenes semanales, chat, proposals y memoria del coach a un JSON descargable.
            </p>
          </div>
          <button
            onClick={() => void handleExport()}
            disabled={isExporting}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            <Download size={14} />
            {isExporting ? 'Exportando...' : 'Exportar'}
          </button>
        </div>
        {exportStatus && (
          <p className="text-xs text-ink-muted mt-3">{exportStatus}</p>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
            <Cpu size={16} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-ink">Información de la app</h2>
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">
              Estado actual del runtime local.
            </p>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink-muted">Versión</span>
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
            <h2 className="text-sm font-semibold text-ink">Notificaciones de sesión</h2>
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">
              Recibe una notificación 30 minutos antes de cada sesión del día.
              Sesiones AM a las 7:30 h · sesiones PM a las 17:30 h.
            </p>
          </div>
        </div>
        {!notificationsSupported() ? (
          <p className="text-xs text-ink-muted">Notificaciones no disponibles en este navegador.</p>
        ) : notifPermission === 'granted' ? (
          <p className="text-xs text-emerald-400 font-medium">Notificaciones activadas</p>
        ) : notifPermission === 'denied' ? (
          <p className="text-xs text-amber-400 leading-relaxed">
            Permiso bloqueado. Actívalas desde los ajustes del navegador para este sitio.
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
              Borra sesiones, chat, resúmenes, proposals y memoria guardada en este navegador.
            </p>
          </div>
        </div>

        {!clearConfirm ? (
          <button
            onClick={() => setClearConfirm(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 text-red-400 text-sm font-semibold hover:bg-red-500/20 transition-colors"
          >
            <Trash2 size={14} />
            Limpiar datos
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-ink-muted leading-relaxed">
              Esta acción no se puede deshacer. Si quieres conservar algo, exporta un backup antes.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setClearConfirm(false)}
                className="px-3 py-2 rounded-xl text-sm text-ink-muted hover:bg-surface-raised transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleClearData()}
                disabled={isClearing}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/20 text-red-400 text-sm font-semibold hover:bg-red-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 size={14} />
                {isClearing ? 'Limpiando...' : 'Confirmar borrado'}
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
