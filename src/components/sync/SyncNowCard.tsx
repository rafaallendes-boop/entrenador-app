import { RefreshCw } from 'lucide-react'
import Card from '../ui/Card'
import { formatLastSync } from './syncNowFormat'
import type { SyncStatus } from '../../store/useAuthStore'

interface SyncNowCardProps {
  status: SyncStatus
  lastSyncAt: number | null
  pendingOps: number
  syncing: boolean
  onSync: () => void
}

export default function SyncNowCard({ status, lastSyncAt, pendingOps, syncing, onSync }: SyncNowCardProps) {
  const hasPending = pendingOps > 0
  const statusLine = hasPending
    ? `${pendingOps} ${pendingOps === 1 ? 'cambio sin sincronizar' : 'cambios sin sincronizar'}`
    : status === 'offline'
      ? 'Sin conexión'
      : 'Al día'

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0">
          <RefreshCw size={16} className={`text-brand-light ${syncing ? 'animate-spin' : ''}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-ink">Sincronización</h2>
          <p className="text-xs text-ink-muted mt-1">
            {statusLine} · Última: {formatLastSync(lastSyncAt)}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onSync}
        disabled={syncing}
        aria-busy={syncing}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand/10 py-2.5 text-sm font-semibold text-brand-light transition-colors hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
        {syncing ? 'Sincronizando…' : 'Sincronizar entrenamientos'}
      </button>
    </Card>
  )
}
