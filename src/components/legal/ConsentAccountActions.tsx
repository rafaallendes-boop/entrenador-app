import { useState } from 'react'

import { useAuthStore } from '../../store/useAuthStore'

type ActionState = 'idle' | 'exporting' | 'deleting' | 'signing_out'

/**
 * Derechos y salida que deben seguir disponibles aunque el gate esté cerrado.
 * No abre Settings ni ninguna función de producto.
 */
export default function ConsentAccountActions() {
  const user = useAuthStore((state) => state.user)
  const signOut = useAuthStore((state) => state.signOut)
  const [action, setAction] = useState<ActionState>('idle')
  const [message, setMessage] = useState<string>()
  const busy = action !== 'idle'

  const exportData = async () => {
    if (busy) return
    setAction('exporting')
    setMessage(undefined)
    try {
      const { downloadAppDataExport } = await import('../../services/dataExport')
      const filename = await downloadAppDataExport()
      setMessage(`Backup exportado: ${filename}`)
    } catch (error) {
      console.error('[consent] account export failed', error)
      setMessage('No pudimos exportar tus datos. Inténtalo nuevamente.')
    } finally {
      setAction('idle')
    }
  }

  const deleteData = async () => {
    if (!user || busy) return
    const confirmed = window.confirm(
      'Esto eliminará tus datos locales y remotos de RallyIQ. La evidencia legal de consentimiento puede conservarse mientras se define su plazo de retención. ¿Quieres continuar?',
    )
    if (!confirmed) return
    if (window.prompt('Escribe BORRAR para confirmar.') !== 'BORRAR') return

    setAction('deleting')
    setMessage(undefined)
    try {
      const { wipeRemoteAndLocalAppData } = await import('../../services/syncService')
      const outcome = await wipeRemoteAndLocalAppData(user.id)
      setMessage(outcome.completed
        ? 'Tus datos de la aplicación fueron eliminados.'
        : 'No pudimos completar el borrado. Tus datos locales se conservaron para evitar inconsistencias.')
    } catch (error) {
      console.error('[consent] account wipe failed', error)
      setMessage('No pudimos eliminar tus datos. Inténtalo nuevamente.')
    } finally {
      setAction('idle')
    }
  }

  const closeSession = async () => {
    if (busy) return
    setAction('signing_out')
    setMessage(undefined)
    try {
      await signOut()
    } catch (error) {
      console.error('[consent] sign out failed', error)
      setMessage('No pudimos cerrar la sesión. Inténtalo nuevamente.')
      setAction('idle')
    }
  }

  return (
    <div className="mt-6 border-t border-surface-border pt-5">
      <p className="text-xs leading-relaxed text-ink-muted">
        No necesitas aceptar para salir ni para ejercer tus derechos sobre los datos.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportData()}
          className="rounded-xl bg-surface-raised px-3 py-2 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-60"
        >
          {action === 'exporting' ? 'Exportando…' : 'Exportar mis datos'}
        </button>
        <button
          type="button"
          disabled={busy || !user}
          onClick={() => void deleteData()}
          className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20 disabled:opacity-60"
        >
          {action === 'deleting' ? 'Eliminando…' : 'Borrar mis datos'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void closeSession()}
          className="rounded-xl bg-surface-raised px-3 py-2 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-60"
        >
          {action === 'signing_out' ? 'Cerrando…' : 'Cerrar sesión'}
        </button>
      </div>
      {message && <p className="mt-3 text-xs text-ink-muted">{message}</p>}
    </div>
  )
}
