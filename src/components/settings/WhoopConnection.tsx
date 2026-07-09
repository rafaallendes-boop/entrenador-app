import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, RefreshCcw, Trash2 } from 'lucide-react'
import Card from '../ui/Card'
import { getActiveAthleteId, getSelfAthleteId } from '../../services/athlete/activeAthlete'
import { useAuthStore } from '../../store/useAuthStore'
import {
  disconnectWhoop,
  getWhoopStatus,
  startWhoopConnect,
  syncWhoopNow,
  type WhoopStatus,
} from '../../services/readiness/whoopApi'
import { pullReadiness } from '../../services/readiness/pullReadiness'
import { clearLocalWhoopReadiness } from '../../services/readiness/localReadiness'

export function WhoopConnection() {
  const activeAthleteFromStore = useAuthStore((state) => state.activeAthleteId)
  const [status, setStatus] = useState<WhoopStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [biometricConsent, setBiometricConsent] = useState(false)
  const [apiAvailable, setApiAvailable] = useState(true)

  const activeAthleteId = activeAthleteFromStore ?? getActiveAthleteId()
  const selfAthleteId = getSelfAthleteId()
  const canConnect = activeAthleteId != null && selfAthleteId != null && activeAthleteId === selfAthleteId

  const refresh = useCallback(async () => {
    try {
      setStatus(await getWhoopStatus())
      setApiAvailable(true)
    } catch (error) {
      console.warn('[whoop] status failed', error)
      setApiAvailable(false)
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const formattedLastSync = useMemo(() => {
    if (!status?.lastSyncAt) return null
    const date = new Date(status.lastSyncAt)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleString()
  }, [status?.lastSyncAt])

  const onConnect = async () => {
    if (!canConnect || !biometricConsent) return
    setMessage(null)
    setBusy(true)
    try {
      window.location.href = await startWhoopConnect()
    } catch (error) {
      console.error('[whoop] connect failed', error)
      setApiAvailable(false)
      setMessage('No se pudo iniciar la conexion con Whoop.')
    } finally {
      setBusy(false)
    }
  }

  const onSync = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await syncWhoopNow()
      if (result.ok) {
        await pullReadiness().catch(() => undefined)
        setMessage('Whoop sincronizado.')
      } else if (result.reason === 'cooldown') {
        const seconds = Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 1000))
        setMessage(`Espera ${seconds}s para volver a sincronizar.`)
      } else if (result.reason === 'no_self_athlete') {
        setMessage('Tu perfil de atleta todavia no esta listo. Reabre la app y reintenta.')
      } else if (result.reason === 'rate_limited') {
        setMessage('Whoop limito las consultas. Reintenta mas tarde.')
      } else {
        setMessage('No se pudo sincronizar Whoop.')
      }
      await refresh()
    } catch (error) {
      console.error('[whoop] sync failed', error)
      setApiAvailable(false)
      setMessage('No se pudo sincronizar Whoop.')
    } finally {
      setBusy(false)
    }
  }

  const onDisconnect = async () => {
    if (!window.confirm('Desconectar Whoop y borrar tus datos de Whoop de RallyIQ?')) return
    setBusy(true)
    setMessage(null)
    try {
      await disconnectWhoop()
      await clearLocalWhoopReadiness(activeAthleteId)
      setMessage('Whoop desconectado.')
      await refresh()
    } catch (error) {
      console.error('[whoop] disconnect failed', error)
      setApiAvailable(false)
      setMessage('No se pudo desconectar Whoop.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand/15">
          <Link size={16} className="text-brand-light" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">Whoop</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Recuperacion, sueno y strain para contexto del check-in y RallyIQ.
          </p>
        </div>
      </div>

      {!apiAvailable && (
        <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          El cliente Whoop aun no esta integrado en este entorno.
        </p>
      )}

      {status?.connected ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-surface-border bg-surface-raised px-3 py-3">
            <p className="text-sm font-semibold text-emerald-400">Conectado</p>
            <p className="mt-1 text-xs text-ink-muted">
              {formattedLastSync ? `Ultima sync ${formattedLastSync}` : 'Sin sincronizacion registrada'}
              {status.lastSyncStatus === 'error' ? ' · ultimo intento fallo' : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onSync()}
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCcw size={14} />
              {busy ? 'Sincronizando...' : 'Sincronizar ahora'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDisconnect()}
              className="inline-flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 size={14} />
              Desconectar
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {!canConnect && (
            <p className="rounded-xl border border-surface-border bg-surface-raised px-3 py-2 text-xs leading-relaxed text-ink-muted">
              La conexion Whoop solo se puede iniciar desde tu propio perfil de atleta.
            </p>
          )}

          {canConnect && (
            <>
              {/* TODO: replace with onboarding consent once client-readiness legal consent lands. */}
              <label className="flex items-start gap-3 rounded-xl border border-surface-border bg-surface-raised px-3 py-3">
                <input
                  type="checkbox"
                  checked={biometricConsent}
                  onChange={(event) => setBiometricConsent(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-surface-border bg-surface"
                />
                <span className="text-xs leading-relaxed text-ink-muted">
                  Acepto usar datos biometricos de Whoop para contexto de entrenamiento. No reemplaza consejo medico y puedo desconectar o borrar estos datos.
                </span>
              </label>
              <button
                type="button"
                disabled={busy || !biometricConsent}
                onClick={() => void onConnect()}
                className="inline-flex items-center gap-2 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Link size={14} />
                Conectar Whoop
              </button>
            </>
          )}
        </div>
      )}

      {message && (
        <p className="mt-3 text-xs text-ink-muted">{message}</p>
      )}
    </Card>
  )
}
