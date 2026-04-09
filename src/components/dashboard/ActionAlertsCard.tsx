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
    shell: 'border-amber-500/30 bg-amber-500/10',
    badge: 'bg-amber-500/20 text-amber-300',
    icon: 'text-amber-300',
    label: 'Prioridad alta',
  },
  medium: {
    shell: 'border-brand/25 bg-brand/8',
    badge: 'bg-brand/15 text-brand-light',
    icon: 'text-brand-light',
    label: 'Prioridad media',
  },
  low: {
    shell: 'border-emerald-500/25 bg-emerald-500/10',
    badge: 'bg-emerald-500/15 text-emerald-300',
    icon: 'text-emerald-300',
    label: 'Seguimiento',
  },
} as const

export default function ActionAlertsCard({ summary, onSelectAction, onOpenAutoAdjustment }: ActionAlertsCardProps) {
  const primaryAction = summary.primaryAction

  if (!primaryAction) {
    return (
      <Card className="p-4 border-emerald-500/20 bg-emerald-500/10">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={16} className="text-emerald-300" />
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
    <Card className={`p-4 ${tone.shell}`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-surface-card/70 border border-white/5 flex items-center justify-center flex-shrink-0">
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
              className="mt-3 inline-flex items-center gap-1 rounded-lg bg-brand/15 px-3 py-1.5 text-[11px] font-semibold text-brand-light transition-colors hover:bg-brand/25"
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
                  className="w-full text-left rounded-xl border border-surface-border bg-surface-card/70 px-3 py-2 hover:border-brand/25 hover:bg-brand/5 transition-colors"
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
