import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import Card from '../ui/Card'
import type { ActionableAlert } from '../../services/actionAlerts'

interface ActionAlertsCardProps {
  alerts: ActionableAlert[]
  onSelectAlert: (alert: ActionableAlert) => void
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

export default function ActionAlertsCard({ alerts, onSelectAlert }: ActionAlertsCardProps) {
  if (alerts.length === 0) {
    return (
      <Card className="p-4 border-emerald-500/20 bg-emerald-500/10">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={16} className="text-emerald-300" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Sin alertas urgentes</p>
            <p className="mt-1 text-xs text-ink-muted leading-relaxed">
              La semana no muestra desajustes obvios. Mantén el check-in al día para seguir afinando el coaching.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  const [primaryAlert, ...secondaryAlerts] = alerts
  const tone = TONE_STYLES[primaryAlert.severity]

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
              onClick={() => onSelectAlert(primaryAlert)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-ink hover:text-brand-light transition-colors"
            >
              {primaryAlert.ctaLabel}
              <ArrowRight size={13} />
            </button>
          </div>

          <p className="text-sm font-semibold text-ink">{primaryAlert.title}</p>
          <p className="mt-1 text-sm text-ink-muted leading-relaxed">{primaryAlert.body}</p>
          <p className="mt-3 text-xs text-ink">
            <span className="font-semibold text-ink">Recomendacion:</span> {primaryAlert.recommendation}
          </p>

          {secondaryAlerts.length > 0 && (
            <div className="mt-4 pt-3 border-t border-surface-border/70 space-y-2">
              {secondaryAlerts.slice(0, 2).map((alert) => (
                <button
                  key={alert.id}
                  type="button"
                  onClick={() => onSelectAlert(alert)}
                  className="w-full text-left rounded-xl border border-surface-border bg-surface-card/70 px-3 py-2 hover:border-brand/25 hover:bg-brand/5 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink truncate">{alert.title}</p>
                      <p className="mt-0.5 text-xs text-ink-muted truncate">{alert.ctaLabel}</p>
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
