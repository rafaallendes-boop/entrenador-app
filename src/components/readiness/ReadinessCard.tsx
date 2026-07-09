import { Activity, Link, Moon, RefreshCcw, TrendingUp } from 'lucide-react'
import type { ComponentType } from 'react'
import type { ReadinessDaily } from '../../types'
import { recoveryBand, type RecoveryBand } from '../../services/readiness/readinessBands'

const BAND_LABEL: Record<RecoveryBand, string> = {
  red: 'Baja',
  yellow: 'Media',
  green: 'Alta',
  none: 'Sin score',
}

const BAND_TEXT: Record<RecoveryBand, string> = {
  red: 'text-red-400',
  yellow: 'text-amber-400',
  green: 'text-emerald-400',
  none: 'text-ink-muted',
}

const BAND_BG: Record<RecoveryBand, string> = {
  red: 'border-red-500/20 bg-red-500/10',
  yellow: 'border-amber-500/20 bg-amber-500/10',
  green: 'border-emerald-500/20 bg-emerald-500/10',
  none: 'border-surface-border bg-surface-raised/60',
}

function hasReadinessMetrics(readiness?: ReadinessDaily): readiness is ReadinessDaily {
  return readiness?.recoveryScore != null ||
    readiness?.hrvMs != null ||
    readiness?.rhrBpm != null ||
    readiness?.strain != null ||
    readiness?.sleepHours != null ||
    readiness?.sleepPerformance != null
}

export function ReadinessCard({
  readiness,
  connected,
  canConnect = true,
  onSync,
  syncMessage,
  syncing = false,
}: {
  readiness?: ReadinessDaily
  connected: boolean
  canConnect?: boolean
  onSync?: () => void
  syncMessage?: string | null
  syncing?: boolean
}) {
  const hasMetrics = hasReadinessMetrics(readiness)
  const syncButton = connected && onSync ? (
    <button
      type="button"
      disabled={syncing}
      onClick={onSync}
      className="inline-flex items-center gap-2 rounded-xl border border-surface-soft/70 bg-surface-raised px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface-card disabled:cursor-not-allowed disabled:opacity-60"
    >
      <RefreshCcw size={13} className={syncing ? 'animate-spin' : ''} />
      {syncing ? 'Sincronizando' : 'Sincronizar'}
    </button>
  ) : null

  if (!hasMetrics && !connected && canConnect) {
    return (
      <section className="relative overflow-hidden rounded-card border border-brand/20 bg-[linear-gradient(145deg,rgba(255,77,0,0.12),rgba(14,14,14,0.96))] p-4 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-brand/20 bg-brand/10">
            <Link size={16} className="text-brand-light" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
              Readiness · Whoop
            </p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              Conecta Whoop para ver recuperacion, sueno y strain del dia.
            </p>
            <a
              href="/settings?whoop=connect"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-light"
            >
              Conectar Whoop
            </a>
          </div>
        </div>
      </section>
    )
  }

  if (!hasMetrics) {
    return (
      <section className="rounded-card border border-surface-soft/70 bg-surface-panel p-4 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
            Readiness · Whoop
          </p>
          {syncButton}
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          Sin datos de Whoop hoy todavia.
        </p>
        {syncMessage && <p className="mt-3 text-xs text-ink-muted">{syncMessage}</p>}
      </section>
    )
  }

  const band = recoveryBand(readiness.recoveryScore)

  return (
    <section className="relative overflow-hidden rounded-card border border-surface-soft/70 bg-[linear-gradient(150deg,rgba(18,18,18,0.98),rgba(9,9,9,1))] p-4 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
            Readiness · Whoop
          </p>
          <p className="mt-1 text-xs text-ink-muted">{readiness.date}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {syncButton}
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${BAND_BG[band]} ${BAND_TEXT[band]}`}>
            {BAND_LABEL[band]}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <ReadinessMetric
          icon={Activity}
          label="Recovery"
          value={readiness.recoveryScore != null ? `${Math.round(readiness.recoveryScore)}%` : '-'}
          valueClass={BAND_TEXT[band]}
        />
        <ReadinessMetric
          icon={Moon}
          label={readiness.sleepPerformance != null ? `Sueno · ${Math.round(readiness.sleepPerformance)}%` : 'Sueno'}
          value={readiness.sleepHours != null ? `${readiness.sleepHours.toFixed(1)}h` : '-'}
        />
        <ReadinessMetric
          icon={TrendingUp}
          label="Strain"
          value={readiness.strain != null ? readiness.strain.toFixed(1) : '-'}
        />
      </div>
      {syncMessage && <p className="mt-3 text-xs text-ink-muted">{syncMessage}</p>}
    </section>
  )
}

function ReadinessMetric({
  icon: Icon,
  label,
  value,
  valueClass = 'text-ink',
}: {
  icon: ComponentType<{ size?: number; className?: string }>
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-3">
      <Icon size={14} className="text-ink-faint" />
      <p className={`mt-2 font-mono text-2xl font-bold leading-none tabular-nums ${valueClass}`}>
        {value}
      </p>
      <p className="mt-1 truncate text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </p>
    </div>
  )
}
