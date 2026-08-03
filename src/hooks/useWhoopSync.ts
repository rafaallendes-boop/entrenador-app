import { useCallback, useEffect, useRef, useState } from 'react'
import { pullReadiness } from '../services/readiness/pullReadiness'
import { pullWorkouts } from '../services/readiness/pullWorkouts'
import { autoCompleteFromWorkouts } from '../services/readiness/autoCompleteFromWorkouts'
import { getWhoopStatus, syncWhoopNow, type WhoopStatus, type WhoopSyncResponse } from '../services/readiness/whoopApi'
import { useAuthStore } from '../store/useAuthStore'
import { isConsentEnforcementEnabled } from '../services/legal/consentFlag'
import { getMissingConsents, hydrateConsents } from '../services/legal/consentService'

export interface UseWhoopSyncOptions {
  onReadinessPulled?: () => Promise<void> | void
}

function messageForSyncResult(result: WhoopSyncResponse): string {
  if (result.ok) return 'Whoop sincronizado.'
  if (result.code === 'consent_required') {
    return 'Aceptá el descargo biométrico en Ajustes para reanudar la sincronización.'
  }
  if (result.reason === 'cooldown') {
    const seconds = Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 1000))
    return `Espera ${seconds}s para volver a sincronizar.`
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
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const [status, setStatus] = useState<WhoopStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [apiAvailable, setApiAvailable] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => () => { mountedRef.current = false }, [])

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

  const syncNow = useCallback(async (): Promise<WhoopSyncResponse | null> => {
    setSyncing(true)
    setMessage(null)
    try {
      if (isConsentEnforcementEnabled() && userId) {
        try {
          let missing = await getMissingConsents(userId, ['whoop_biometric'])
          if (missing.length > 0) {
            const hydrated = await hydrateConsents(userId)
            if (!hydrated.ok) {
              if (mountedRef.current) {
                setMessage('No pudimos verificar tu consentimiento biométrico. Revisá tu conexión.')
              }
              return null
            }
            missing = await getMissingConsents(userId, ['whoop_biometric'])
          }
          if (missing.length > 0) {
            if (mountedRef.current) {
              setMessage('Aceptá el descargo biométrico en Ajustes para reanudar la sincronización.')
            }
            return null
          }
        } catch {
          if (mountedRef.current) {
            setMessage('No pudimos verificar tu consentimiento biométrico. Revisá tu conexión.')
          }
          return null
        }
      }

      const result = await syncWhoopAndRefreshLocalData(onReadinessPulled)

      if (mountedRef.current) setMessage(messageForSyncResult(result))
      await refreshStatus()
      return result
    } catch (error) {
      console.error('[whoop] sync failed', error)
      if (mountedRef.current) {
        setApiAvailable(false)
        setMessage('No se pudo sincronizar Whoop.')
      }
      return null
    } finally {
      if (mountedRef.current) setSyncing(false)
    }
  }, [onReadinessPulled, refreshStatus, userId])

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
