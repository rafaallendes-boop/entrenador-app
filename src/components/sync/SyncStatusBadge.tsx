import { Cloud, CloudOff } from 'lucide-react'

interface SyncStatusBadgeProps {
  status: string
  error: string | null
  compact?: boolean
  pendingOps?: number
}

export default function SyncStatusBadge({ status, error, compact = false, pendingOps = 0 }: SyncStatusBadgeProps) {
  const iconSize = compact ? 11 : 12
  const labelClass = compact ? 'text-[10px]' : 'text-xs'

  if (status === 'syncing') {
    return (
      <span className={`inline-flex items-center gap-1 text-brand-light ${labelClass}`}>
        <Cloud size={iconSize} className="animate-pulse" />
        {compact ? 'Sync' : 'Sincronizando'}
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span className={`inline-flex items-center gap-1 text-amber-400 ${labelClass}`} title={error ?? undefined}>
        <CloudOff size={iconSize} />
        {compact ? (pendingOps > 0 ? `Error ${pendingOps}` : 'Error') : pendingOps > 0 ? `Error sync · ${pendingOps} pendientes` : 'Error sync'}
      </span>
    )
  }

  if (status === 'offline') {
    return (
      <span className={`inline-flex items-center gap-1 text-ink-muted ${labelClass}`}>
        <CloudOff size={iconSize} />
        {compact ? (pendingOps > 0 ? `Off ${pendingOps}` : 'Offline') : pendingOps > 0 ? `Sin conexion · ${pendingOps} pendientes` : 'Sin conexion'}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 text-emerald-400 ${labelClass}`}>
      <Cloud size={iconSize} />
      {compact ? 'OK' : 'Sincronizado'}
    </span>
  )
}
