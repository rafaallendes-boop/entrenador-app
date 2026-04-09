import { ArrowRight, CalendarRange, CheckCircle2, ClipboardList, MessageSquareText, Siren, TriangleAlert } from 'lucide-react'
import Card from '../ui/Card'
import type { WeeklyActionItem, WeeklyActionSummary } from '../../types'

interface WeeklyActionCenterCardProps {
  summary: WeeklyActionSummary
  onSelectAction: (action: WeeklyActionItem) => void
}

const STATUS_LABELS = {
  adherence: {
    unknown: 'Adherencia sin señal',
    no_plan: 'Sin plan',
    on_track: 'Adherencia en rango',
    low: 'Adherencia baja',
    at_risk: 'Adherencia en riesgo',
  },
  checkIn: {
    complete: 'Check-in al día',
    pending: 'Check-in pendiente',
    not_needed: 'Sin check-in crítico',
  },
  coherence: {
    ok: 'Coherencia ok',
    warning: 'Coherencia con warning',
  },
  weekState: {
    empty: 'Semana vacía',
    planned: 'Semana planificada',
    needs_attention: 'Semana a corregir',
    on_track: 'Semana encaminada',
  },
} as const

export default function WeeklyActionCenterCard({ summary, onSelectAction }: WeeklyActionCenterCardProps) {
  const primaryAction = summary.primaryAction

  return (
    <Card className="p-4 border-brand/15 bg-gradient-to-br from-brand/8 via-surface-card to-surface-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Weekly action loop</p>
          <h2 className="mt-1 text-base font-semibold text-ink">Centro de acciones de la semana</h2>
          <p className="mt-1 text-sm text-ink-muted leading-relaxed">
            {STATUS_LABELS.weekState[summary.weekState]}
          </p>
        </div>
        <div className="inline-flex items-center rounded-full border border-surface-border bg-surface-raised px-3 py-1 text-[11px] font-medium text-ink-muted">
          {summary.weekState === 'on_track' ? 'Sin bloqueos' : 'Acción sugerida'}
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <StatusPill icon={CalendarRange} label={STATUS_LABELS.adherence[summary.adherenceStatus]} />
        <StatusPill icon={ClipboardList} label={STATUS_LABELS.checkIn[summary.checkInStatus]} />
        <StatusPill
          icon={summary.coherenceStatus === 'warning' ? TriangleAlert : CheckCircle2}
          label={STATUS_LABELS.coherence[summary.coherenceStatus]}
        />
      </div>

      {primaryAction ? (
        <div className="mt-4 rounded-2xl border border-surface-border bg-surface-card/80 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand/12 text-brand-light">
              <Siren size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{primaryAction.title}</p>
              <p className="mt-1 text-sm text-ink-muted leading-relaxed">{primaryAction.body}</p>
              <p className="mt-3 text-xs text-ink">
                <span className="font-semibold text-ink">Motivo:</span> {primaryAction.reason}
              </p>
              <button
                type="button"
                onClick={() => onSelectAction(primaryAction)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-light"
              >
                {primaryAction.ctaLabel}
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">Semana bajo control</p>
              <p className="mt-1 text-sm text-ink-muted leading-relaxed">
                No hay una acción crítica por ejecutar. Mantén el check-in y usa el coach si cambia tu fatiga o disponibilidad.
              </p>
            </div>
          </div>
        </div>
      )}

      {summary.secondaryActions.length > 0 && (
        <div className="mt-4 space-y-2">
          {summary.secondaryActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => onSelectAction(action)}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-surface-border bg-surface-card/80 px-3 py-3 text-left transition-colors hover:border-brand/30 hover:bg-brand/5"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink">{action.title}</p>
                <p className="mt-0.5 text-xs text-ink-muted leading-relaxed">{action.ctaLabel}</p>
              </div>
              <MessageSquareText size={14} className="flex-shrink-0 text-ink-faint" />
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

function StatusPill({
  icon: Icon,
  label,
}: {
  icon: typeof CalendarRange
  label: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-surface-border bg-surface-card/70 px-3 py-2">
      <Icon size={14} className="text-ink-faint" />
      <span className="text-xs font-medium text-ink-muted">{label}</span>
    </div>
  )
}
