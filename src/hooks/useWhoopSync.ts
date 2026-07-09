import { useCallback, useEffect, useRef, useState } from 'react'
import { pullReadiness } from '../services/readiness/pullReadiness'
import { getWhoopStatus, syncWhoopNow, type WhoopStatus, type WhoopSyncResponse } from '../services/readiness/whoopApi'

export interface UseWhoopSyncOptions {
  onReadinessPulled?: () => Promise<void> | void
}

function messageForSyncResult(result: WhoopSyncResponse): string {
  if (result.ok) return 'Whoop sincronizado.'
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

export function useWhoopSync(options: UseWhoopSyncOptions = {}) {
  const onReadinessPulled = options.onReadinessPulled
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
      const result = await syncWhoopNow()
      if (result.ok) {
        await pullReadiness().catch(() => undefined)
        await onReadinessPulled?.()
      }

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
  }, [onReadinessPulled, refreshStatus])

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
