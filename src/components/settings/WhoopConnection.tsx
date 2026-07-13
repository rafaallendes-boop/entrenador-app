import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Link, RefreshCcw, Trash2 } from 'lucide-react'
import Card from '../ui/Card'
import { getActiveAthleteId, getSelfAthleteId } from '../../services/athlete/activeAthlete'
import { backfillLocalAthleteScope } from '../../services/athlete/athleteScopeMigration'
import { hydrateActiveAthlete } from '../../services/athlete/hydrateActiveAthlete'
import { useAuthStore } from '../../store/useAuthStore'
import {
  disconnectWhoop,
  startWhoopConnect,
} from '../../services/readiness/whoopApi'
import { clearLocalWhoopReadiness, clearLocalWhoopWorkouts } from '../../services/readiness/localReadiness'
import { useWhoopSync } from '../../hooks/useWhoopSync'
import { Browser } from '@capacitor/browser'
import { isNativePlatform } from '../../services/platform'

export function WhoopConnection() {
  const location = useLocation()
  const activeAthleteFromStore = useAuthStore((state) => state.activeAthleteId)
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [biometricConsent, setBiometricConsent] = useState(false)
  const {
    apiAvailable,
    clearMessage: clearSyncMessage,
    message: syncMessage,
    refreshStatus: refresh,
    status,
    syncing,
    syncNow,
  } = useWhoopSync()

  const activeAthleteId = activeAthleteFromStore ?? getActiveAthleteId()
  const selfAthleteId = getSelfAthleteId()
  // A fresh native install can render Settings before the async athlete
  // hydration finishes. With no selection yet, the signed-in owner is the only
  // safe scope, so don't incorrectly disable the self-only Whoop action.
  const canConnect = activeAthleteId == null
    ? true
    : selfAthleteId != null && activeAthleteId === selfAthleteId
  const needsWorkoutScope = canConnect
    && Boolean(status?.connected)
    && !(status?.scopes ?? []).includes('read:workout')
  const actionBusy = busy || syncing
  const displayMessage = message ?? syncMessage
  const oauthResult = new URLSearchParams(location.search).get('whoop')
  const oauthErrorReason = new URLSearchParams(location.search).get('reason')

  const oauthMessage = useMemo(() => {
    if (oauthResult === 'connected') return 'Whoop conectado.'
    if (oauthResult !== 'error') return null
    if (oauthErrorReason === 'authorization_denied') return 'No se autorizó la conexión con Whoop.'
    if (oauthErrorReason === 'expired_state') return 'La autorización demoró demasiado. Intenta conectar Whoop nuevamente.'
    if (oauthErrorReason === 'token_exchange') return 'Whoop no pudo completar la autorización. Intenta nuevamente.'
    return 'No se pudo completar la conexión con Whoop.'
  }, [oauthErrorReason, oauthResult])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!userId || (activeAthleteId != null && selfAthleteId != null)) return
    let cancelled = false
    void (async () => {
      try {
        const backfilled = await backfillLocalAthleteScope(userId)
        if (cancelled || backfilled == null) return
        const active = await hydrateActiveAthlete(userId)
        if (!cancelled) useAuthStore.getState().setActiveAthleteId(active)
      } catch (error) {
        console.warn('[whoop] athlete context hydration failed', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeAthleteId, selfAthleteId, userId])

  const formattedLastSync = useMemo(() => {
    if (!status?.lastSyncAt) return null
    const date = new Date(status.lastSyncAt)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleString()
  }, [status?.lastSyncAt])

  const launchWhoopOAuth = async () => {
    const native = isNativePlatform()
    const url = await startWhoopConnect({ nativeReturn: native })
    if (native) {
      // The server returns to rallyiq://settings after Whoop stores the
      // connection. browserFinished remains as a cancellation/dismiss fallback.
      const listener = await Browser.addListener('browserFinished', () => {
        void listener.remove()
        void refresh()
      })
      await Browser.open({ url, presentationStyle: 'popover' })
    } else {
      window.location.href = url
    }
  }

  const onConnect = async () => {
    if (!canConnect || !biometricConsent) return
    setMessage(null)
    clearSyncMessage()
    setBusy(true)
    try {
      await launchWhoopOAuth()
    } catch (error) {
      console.error('[whoop] connect failed', error)
      setMessage('No se pudo iniciar la conexion con Whoop.')
    } finally {
      setBusy(false)
    }
  }

  const onReconnect = async () => {
    if (!canConnect) return
    setMessage(null)
    clearSyncMessage()
    setBusy(true)
    try {
      await launchWhoopOAuth()
    } catch (error) {
      console.error('[whoop] reconnect failed', error)
      setMessage('No se pudo iniciar la reconexion con Whoop.')
    } finally {
      setBusy(false)
    }
  }

  const onSync = async () => {
    setMessage(null)
    await syncNow()
  }

  const onDisconnect = async () => {
    if (!window.confirm('Desconectar Whoop y borrar tus datos de Whoop de RallyIQ?')) return
    setBusy(true)
    setMessage(null)
    clearSyncMessage()
    try {
      await disconnectWhoop()
      if (selfAthleteId) {
        await clearLocalWhoopReadiness(selfAthleteId)
        await clearLocalWhoopWorkouts(selfAthleteId)
      } else {
        console.warn('[whoop] disconnected before self athlete hydration; local cache retained')
      }
      setMessage('Whoop desconectado.')
      await refresh()
    } catch (error) {
      console.error('[whoop] disconnect failed', error)
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
          {needsWorkoutScope && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3">
              <p className="text-xs leading-relaxed text-amber-300">
                Reconecta Whoop para sincronizar entrenamientos.
              </p>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void onReconnect()}
                className="mt-2 inline-flex items-center gap-2 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Link size={12} />
                Reconectar Whoop
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void onSync()}
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Sincronizando...' : 'Sincronizar ahora'}
            </button>
            <button
              type="button"
              disabled={actionBusy}
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
                  Acepto usar datos biométricos de Whoop para contexto de entrenamiento. No reemplaza consejo médico y puedo desconectar o borrar estos datos.
                </span>
              </label>
              <button
                type="button"
                disabled={actionBusy || !biometricConsent}
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

      {(displayMessage ?? oauthMessage) && (
        <p className="mt-3 text-xs text-ink-muted">{displayMessage ?? oauthMessage}</p>
      )}
    </Card>
  )
}
