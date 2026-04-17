import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import Card from '../ui/Card'
import type { WeeklyActionItem, WeeklyActionSummary } from '../../types'

interface ActionAlertsCardProps {
  summary: WeeklyActionSummary
  onSelectAction: (action: WeeklyActionItem) => void
  onOpenAutoAdjustment?: () => void
}

const TONE_STYLES = {
  high: {
    shell: 'border-forge-ember/25 bg-[linear-gradient(145deg,rgba(255,235,156,0.14),rgba(14,14,14,0.96))]',
    badge: 'bg-forge-ember/15 text-forge-ember',
    icon: 'text-forge-ember',
    label: 'Prioridad alta',
    accent: 'ember',
  },
  medium: {
    shell: 'border-brand/20 bg-[linear-gradient(145deg,rgba(255,77,0,0.10),rgba(14,14,14,0.96))]',
    badge: 'bg-brand/12 text-brand-light',
    icon: 'text-brand-light',
    label: 'Prioridad media',
    accent: 'lime',
  },
  low: {
    shell: 'border-forge-cyan/20 bg-[linear-gradient(145deg,rgba(0,227,253,0.14),rgba(14,14,14,0.96))]',
    badge: 'bg-forge-cyan/12 text-forge-cyan',
    icon: 'text-forge-cyan',
    label: 'Seguimiento',
    accent: 'cyan',
  },
} as const

export default function ActionAlertsCard({ summary, onSelectAction, onOpenAutoAdjustment }: ActionAlertsCardProps) {
  const primaryAction = summary.primaryAction

  if (!primaryAction) {
    return (
      <Card variant="hud" accent="cyan" className="p-4 border-forge-cyan/20 bg-[linear-gradient(145deg,rgba(0,227,253,0.12),rgba(14,14,14,0.96))]">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-forge-cyan/20 bg-forge-cyan/10">
            <CheckCircle2 size={16} className="text-forge-cyan" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Sin alertas urgentes</p>
            <p className="mt-1 text-xs text-ink-muted leading-relaxed">
              La semana viene alineada. Mantén el check-in al día para seguir afinando el coaching.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  const tone = primaryAction.kind === 'plan_week' || primaryAction.kind === 'fix_coherence'
    ? TONE_STYLES.high
    : primaryAction.kind === 'review_coach_note'
      ? TONE_STYLES.low
      : TONE_STYLES.medium

  return (
    <Card variant="hud" accent={tone.accent} className={`p-4 ${tone.shell}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-white/5 bg-surface-card/70">
          <AlertTriangle size={18} className={tone.icon} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${tone.badge}`}>
              {tone.label}
            </span>
            <button
              type="button"
              onClick={() => onSelectAction(primaryAction)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-ink hover:text-brand-light transition-colors"
            >
              {primaryAction.ctaLabel}
              <ArrowRight size={13} />
            </button>
          </div>

          <p className="text-sm font-semibold text-ink">{primaryAction.title}</p>
          <p className="mt-1 text-sm text-ink-muted leading-relaxed">{primaryAction.body}</p>
          <p className="mt-3 text-xs text-ink">
            <span className="font-semibold text-ink">Recomendación:</span> {primaryAction.reason}
          </p>

          {onOpenAutoAdjustment && (
            <button
              type="button"
              onClick={onOpenAutoAdjustment}
              className="mt-3 inline-flex items-center gap-1 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-[11px] font-semibold text-brand-light transition-colors hover:bg-brand/15"
            >
              Ver ajuste rapido
              <ArrowRight size={12} />
            </button>
          )}

          {summary.secondaryActions.length > 0 && (
            <div className="mt-4 pt-3 border-t border-surface-border/70 space-y-2">
              {summary.secondaryActions.slice(0, 2).map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => onSelectAction(action)}
                  className="w-full rounded-xl border border-surface-border bg-surface-card/70 px-3 py-2 text-left transition-colors hover:border-forge-cyan/20 hover:bg-forge-cyan/5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink truncate">{action.title}</p>
                      <p className="mt-0.5 text-xs text-ink-muted truncate">{action.ctaLabel}</p>
                    </div>
                    <ArrowRight size={13} className="text-ink-faint flex-shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
