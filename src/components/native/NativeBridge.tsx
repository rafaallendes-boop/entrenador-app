import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { consumePendingNativeNavigation, NATIVE_AUTH_ERROR_EVENT, NATIVE_NAVIGATE_EVENT } from '../../services/nativeApp'
import { isNativePlatform } from '../../services/platform'

export default function NativeBridge() {
  const navigate = useNavigate()
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    if (!isNativePlatform()) return

    const onNavigate = (event: Event) => {
      const path = (event as CustomEvent<unknown>).detail
      if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) {
        navigate(path, { replace: true })
      }
    }
    const onAuthError = (event: Event) => {
      const message = (event as CustomEvent<unknown>).detail
      setAuthError(typeof message === 'string' ? message : 'No se pudo completar el login.')
    }
    window.addEventListener(NATIVE_NAVIGATE_EVENT, onNavigate)
    window.addEventListener(NATIVE_AUTH_ERROR_EVENT, onAuthError)
    const pendingPath = consumePendingNativeNavigation()
    if (pendingPath) navigate(pendingPath, { replace: true })
    return () => {
      window.removeEventListener(NATIVE_NAVIGATE_EVENT, onNavigate)
      window.removeEventListener(NATIVE_AUTH_ERROR_EVENT, onAuthError)
    }
  }, [navigate])

  if (!authError) return null
  return (
    <div className="fixed inset-x-4 top-safe z-[100] mx-auto max-w-lg rounded-xl border border-red-500/30 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <p>{authError}</p>
        <button type="button" className="font-semibold text-red-200" onClick={() => setAuthError(null)}>
          Cerrar
        </button>
      </div>
    </div>
  )
}
