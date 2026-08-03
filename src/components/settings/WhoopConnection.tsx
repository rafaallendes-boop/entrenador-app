import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Link, RefreshCcw, Trash2 } from 'lucide-react'
import Card from '../ui/Card'
import { getActiveAthleteId, getSelfAthleteId } from '../../services/athlete/activeAthlete'
import { backfillLocalAthleteScope } from '../../services/athlete/athleteScopeMigration'
import { hydrateActiveAthlete } from '../../services/athlete/hydrateActiveAthlete'
import { useAuthStore } from '../../store/useAuthStore'
import {
  disconnectWhoop,
  isWhoopConsentRequiredError,
  startWhoopConnect,
} from '../../services/readiness/whoopApi'
import { clearLocalWhoopReadiness, clearLocalWhoopWorkouts } from '../../services/readiness/localReadiness'
import { useWhoopSync } from '../../hooks/useWhoopSync'
import { Browser } from '@capacitor/browser'
import { isNativePlatform } from '../../services/platform'
import { isConsentEnforcementEnabled } from '../../services/legal/consentFlag'
import {
  getMissingConsents,
  hydrateConsents,
  verifyCurrentConsentRemotely,
} from '../../services/legal/consentService'
import ConsentScreen from '../legal/ConsentScreen'

type ConsentCheckState = 'checking' | 'current' | 'missing' | 'unavailable'

export function WhoopConnection() {
  const location = useLocation()
  const activeAthleteFromStore = useAuthStore((state) => state.activeAthleteId)
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const consentEnabled = isConsentEnforcementEnabled()
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [biometricConsent, setBiometricConsent] = useState(false)
  const [consentState, setConsentState] = useState<ConsentCheckState>(
    consentEnabled ? 'checking' : 'current',
  )
  const consentRefreshRef = useRef(0)
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
  const consentBlocksWhoop = consentEnabled && consentState !== 'current'
  const displayMessage = message ?? syncMessage
  const oauthResult = new URLSearchParams(location.search).get('whoop')
  const oauthErrorReason = new URLSearchParams(location.search).get('reason')

  const oauthMessage = useMemo(() => {
    if (oauthResult === 'connected') return 'Whoop conectado.'
    if (oauthResult !== 'error') return null
    if (oauthErrorReason === 'authorization_denied') return 'No se autorizó la conexión con Whoop.'
    if (oauthErrorReason === 'expired_state') return 'La autorización demoró demasiado. Intenta conectar Whoop nuevamente.'
    if (oauthErrorReason === 'consent_required') return 'Aceptá el descargo biométrico para conectar Whoop.'
    if (oauthErrorReason === 'token_exchange') return 'Whoop no pudo completar la autorización. Intenta nuevamente.'
    return 'No se pudo completar la conexión con Whoop.'
  }, [oauthErrorReason, oauthResult])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const refreshConsent = useCallback(async () => {
    const refreshId = ++consentRefreshRef.current
    if (!consentEnabled) {
      setConsentState('current')
      return
    }
    if (!userId) {
      setConsentState('checking')
      return
    }

    setConsentState('checking')
    try {
      const localMissing = await getMissingConsents(userId, ['whoop_biometric'])
      if (refreshId !== consentRefreshRef.current) return
      if (localMissing.length === 0) {
        setConsentState('current')
        return
      }

      const hydrated = await hydrateConsents(userId)
      if (refreshId !== consentRefreshRef.current) return
      if (!hydrated.ok) {
        setConsentState('unavailable')
        return
      }

      const missing = await getMissingConsents(userId, ['whoop_biometric'])
      if (refreshId === consentRefreshRef.current) {
        setConsentState(missing.length > 0 ? 'missing' : 'current')
      }
    } catch {
      if (refreshId === consentRefreshRef.current) setConsentState('unavailable')
    }
  }, [consentEnabled, userId])

  const reconcileServerConsentRejection = useCallback(async () => {
    const refreshId = ++consentRefreshRef.current
    if (!consentEnabled || !userId) return

    setConsentState('checking')
    try {
      const remote = await verifyCurrentConsentRemotely(userId, 'whoop_biometric')
      if (refreshId !== consentRefreshRef.current) return
      // Si el cliente confirma la fila que el servidor rechazó, hay una
      // discrepancia de autoridad: no inducir una aceptación duplicada.
      setConsentState(remote.ok && !remote.current ? 'missing' : 'unavailable')
    } catch {
      if (refreshId === consentRefreshRef.current) setConsentState('unavailable')
    }
  }, [consentEnabled, userId])

  useEffect(() => {
    void refreshConsent()
    return () => {
      consentRefreshRef.current += 1
    }
  }, [refreshConsent, status?.connected])

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
    if (!canConnect || (consentEnabled ? consentState !== 'current' : !biometricConsent)) return
    setMessage(null)
    clearSyncMessage()
    setBusy(true)
    try {
      await launchWhoopOAuth()
    } catch (error) {
      if (isWhoopConsentRequiredError(error)) {
        await reconcileServerConsentRejection()
        setMessage('Whoop requiere volver a verificar tu consentimiento biométrico.')
        return
      }
      console.error('[whoop] connect failed', error)
      setMessage('No se pudo iniciar la conexion con Whoop.')
    } finally {
      setBusy(false)
    }
  }

  const onReconnect = async () => {
    if (!canConnect || consentBlocksWhoop) return
    setMessage(null)
    clearSyncMessage()
    setBusy(true)
    try {
      await launchWhoopOAuth()
    } catch (error) {
      if (isWhoopConsentRequiredError(error)) {
        await reconcileServerConsentRejection()
        setMessage('Whoop requiere volver a verificar tu consentimiento biométrico.')
        return
      }
      console.error('[whoop] reconnect failed', error)
      setMessage('No se pudo iniciar la reconexion con Whoop.')
    } finally {
      setBusy(false)
    }
  }

  const onSync = async () => {
    if (consentBlocksWhoop) return
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

      {consentEnabled && consentState === 'checking' && (
        <p className="mt-3 rounded-xl border border-surface-border bg-surface-raised px-3 py-2 text-xs text-ink-muted">
          Verificando tu consentimiento biométrico…
        </p>
      )}

      {consentEnabled && consentState === 'unavailable' && (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3">
          <p className="text-xs leading-relaxed text-amber-300">
            No pudimos verificar tu consentimiento biométrico. Revisá tu conexión o reabrí la app antes de continuar.
          </p>
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void refreshConsent()}
            className="mt-2 rounded-xl border border-amber-400/30 px-3 py-2 text-xs font-semibold text-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reintentar
          </button>
        </div>
      )}

      {consentEnabled && consentState === 'missing' && (
        <div className="mt-3">
          <ConsentScreen
            variant="inline"
            documents={['whoop_biometric']}
            isUpdate={Boolean(status?.connected)}
            onAccepted={() => void refreshConsent()}
          />
          {Boolean(status?.connected) && (
            <p className="mt-3 text-xs text-ink-muted">
              Pausamos la sincronización hasta que aceptes el descargo actualizado.
            </p>
          )}
        </div>
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
                disabled={actionBusy || consentBlocksWhoop}
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
              disabled={actionBusy || consentBlocksWhoop}
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
              {!consentEnabled && (
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
              )}
              <button
                type="button"
                disabled={actionBusy || (consentEnabled ? consentState !== 'current' : !biometricConsent)}
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
