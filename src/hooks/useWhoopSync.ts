import { useCallback, useEffect, useRef, useState } from 'react'
import { pullReadiness } from '../services/readiness/pullReadiness'
import { pullWorkouts } from '../services/readiness/pullWorkouts'
import { autoCompleteFromWorkouts } from '../services/readiness/autoCompleteFromWorkouts'
import { getWhoopStatus, syncWhoopNow, type WhoopStatus, type WhoopSyncResponse } from '../services/readiness/whoopApi'
import { useAuthStore } from '../store/useAuthStore'
import { isConsentEnforcementEnabled } from '../services/legal/consentFlag'
import { getMissingConsents, hydrateConsents } from '../services/legal/consentService'
import { shouldAutoSyncWhoop } from '../services/readiness/whoopAutoSync'

export interface UseWhoopSyncOptions {
  onReadinessPulled?: () => Promise<void> | void
  /** Dispara un sync silencioso al montar si el estado remoto no esta fresco. */
  autoSync?: boolean
}

export interface SyncNowOptions {
  /** Un sync de fondo no escribe carteles; solo `consent_required` se muestra igual. */
  silent?: boolean
}

const CONSENT_REQUIRED_MESSAGE =
  'Aceptá el descargo biométrico en Ajustes para reanudar la sincronización.'

/** Redondea hacia arriba: mostrar menos tiempo del real invita a reintentar antes de tiempo. */
function formatRetryDelay(retryAfterMs: number | undefined): string {
  const seconds = Math.max(1, Math.ceil((retryAfterMs ?? 0) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.ceil(seconds / 60)} min`
}

function messageForSyncResult(result: WhoopSyncResponse): string {
  if (result.ok) return 'Whoop sincronizado.'
  if (result.code === 'consent_required') return CONSENT_REQUIRED_MESSAGE
  if (result.reason === 'cooldown') {
    return `Whoop ya está al día. Podés volver a sincronizar en ${formatRetryDelay(result.retryAfterMs)}.`
  }
  if (result.reason === 'no_self_athlete') {
    return 'Tu perfil de atleta todavia no esta listo. Reabre la app y reintenta.'
  }
  if (result.reason === 'rate_limited') {
    return 'Whoop limito las consultas. Reintenta mas tarde.'
  }
  if (result.reason === 'no_connection') {
    return 'Whoop no esta conectado.'
  }
  return 'No se pudo sincronizar Whoop.'
}

export async function syncWhoopAndRefreshLocalData(
  onReadinessPulled?: () => Promise<void> | void,
): Promise<WhoopSyncResponse> {
  const result = await syncWhoopNow()
  if (result.ok) {
    await pullReadiness().catch(() => undefined)
    await pullWorkouts()
      .then(() => autoCompleteFromWorkouts())
      .catch(() => undefined)
    await onReadinessPulled?.()
  }
  return result
}

export function useWhoopSync(options: UseWhoopSyncOptions = {}) {
  const onReadinessPulled = options.onReadinessPulled
  const autoSync = options.autoSync === true
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const [status, setStatus] = useState<WhoopStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [apiAvailable, setApiAvailable] = useState(true)
  const mountedRef = useRef(true)
  const syncInFlightRef = useRef(false)
  const onReadinessPulledRef = useRef(onReadinessPulled)

  useEffect(() => {
    onReadinessPulledRef.current = onReadinessPulled
  })

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const refreshStatus = useCallback(async (): Promise<WhoopStatus | null> => {
    try {
      const nextStatus = await getWhoopStatus()
      if (mountedRef.current) {
        setStatus(nextStatus)
        setApiAvailable(true)
      }
      return nextStatus
    } catch (error) {
      console.warn('[whoop] status failed', error)
      if (mountedRef.current) {
        setStatus(null)
        setApiAvailable(false)
      }
      return null
    }
  }, [])

  const syncNow = useCallback(async (
    options: SyncNowOptions = {},
  ): Promise<WhoopSyncResponse | null> => {
    if (syncInFlightRef.current) return null
    syncInFlightRef.current = true

    const silent = options.silent === true
    const showMessage = (text: string, force = false) => {
      if (!mountedRef.current) return
      if (silent && !force) return
      setMessage(text)
    }

    setSyncing(true)
    if (!silent) setMessage(null)
    try {
      if (isConsentEnforcementEnabled() && userId) {
        try {
          let missing = await getMissingConsents(userId, ['whoop_biometric'])
          if (missing.length > 0) {
            const hydrated = await hydrateConsents(userId)
            if (!hydrated.ok) {
              showMessage('No pudimos verificar tu consentimiento biométrico. Revisá tu conexión.')
              return null
            }
            missing = await getMissingConsents(userId, ['whoop_biometric'])
          }
          if (missing.length > 0) {
            showMessage(CONSENT_REQUIRED_MESSAGE, true)
            return null
          }
        } catch {
          showMessage('No pudimos verificar tu consentimiento biométrico. Revisá tu conexión.')
          return null
        }
      }

      const result = await syncWhoopAndRefreshLocalData(onReadinessPulledRef.current)

      showMessage(messageForSyncResult(result), result.code === 'consent_required')
      await refreshStatus()
      return result
    } catch (error) {
      console.error('[whoop] sync failed', error)
      if (mountedRef.current) setApiAvailable(false)
      showMessage('No se pudo sincronizar Whoop.')
      return null
    } finally {
      syncInFlightRef.current = false
      if (mountedRef.current) setSyncing(false)
    }
  }, [refreshStatus, userId])

  useEffect(() => {
    if (!autoSync) return
    let cancelled = false

    void (async () => {
      const nextStatus = await refreshStatus()
      if (cancelled || nextStatus === null) return

      const stale = shouldAutoSyncWhoop({
        connected: nextStatus.connected,
        lastSyncAt: nextStatus.lastSyncAt,
        lastSyncStatus: nextStatus.lastSyncStatus,
        now: Date.now(),
      })
      if (!stale || cancelled) return

      await syncNow({ silent: true })
    })()

    return () => { cancelled = true }
  }, [autoSync, refreshStatus, syncNow])

  const clearMessage = useCallback(() => {
    setMessage(null)
  }, [])

  return {
    apiAvailable,
    clearMessage,
    message,
    refreshStatus,
    status,
    syncing,
    syncNow,
  }
}
