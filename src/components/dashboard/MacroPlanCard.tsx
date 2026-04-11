import { Calendar, Pencil, Target, Trash2, TrendingUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { MacroPlan, MacroPlanSportDetail } from '../../types'
import { formatWeeksRemaining, getPhaseLabel } from '../../services/macroPlan'
import { ROUTES } from '../../constants/routes'
import { SPORT_LABELS } from '../../utils/sport'
import Card from '../ui/Card'

const PHASE_COLOR: Record<MacroPlan['currentPhase'], string> = {
  base: 'text-sky-400',
  build: 'text-amber-400',
  peak: 'text-orange-400',
  taper: 'text-emerald-400',
  race: 'text-rose-400',
  transition: 'text-violet-400',
}

const PHASE_BG: Record<MacroPlan['currentPhase'], string> = {
  base: 'bg-sky-500/10 border-sky-500/20',
  build: 'bg-amber-500/10 border-amber-500/20',
  peak: 'bg-orange-500/10 border-orange-500/20',
  taper: 'bg-emerald-500/10 border-emerald-500/20',
  race: 'bg-rose-500/10 border-rose-500/20',
  transition: 'bg-violet-500/10 border-violet-500/20',
}

interface MacroPlanCardProps {
  macroPlan: MacroPlan
  eventTitle?: string
  isDeleting?: boolean
  onDelete?: () => void
}

export default function MacroPlanCard({
  macroPlan,
  eventTitle,
  isDeleting = false,
  onDelete,
}: MacroPlanCardProps) {
  const navigate = useNavigate()
  const phaseLabel = getPhaseLabel(macroPlan.currentPhase)
  const weeksLabel = formatWeeksRemaining(macroPlan.weeksRemaining)
  const phaseColor = PHASE_COLOR[macroPlan.currentPhase] ?? 'text-ink-muted'
  const phaseBg = PHASE_BG[macroPlan.currentPhase] ?? 'bg-surface-raised border-surface-border'
  const visibleSportDetails = macroPlan.sportDetails
  const visibleTimeline = macroPlan.timeline.slice(0, 5)

  return (
    <Card className={`p-4 border ${phaseBg}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-full bg-surface-raised flex items-center justify-center flex-shrink-0">
          <Target size={16} className={phaseColor} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            Objetivo principal
          </h2>
          {eventTitle && (
            <p className="text-sm font-medium text-ink mt-0.5 truncate">{eventTitle}</p>
          )}
          <p className="mt-1 text-xs text-ink-muted leading-relaxed">{macroPlan.headline}</p>
        </div>
        <div className="flex items-center gap-1">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              className="flex-shrink-0 flex items-center gap-1 text-xs text-rose-300 hover:text-rose-200 transition-colors px-2 py-1 rounded-lg hover:bg-rose-500/10 disabled:opacity-50"
            >
              <Trash2 size={11} />
              {isDeleting ? 'Eliminando' : 'Eliminar'}
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate(ROUTES.COMPETITION_PLAN)}
            className="flex-shrink-0 flex items-center gap-1 text-xs text-ink-faint hover:text-ink-muted transition-colors px-2 py-1 rounded-lg hover:bg-surface-raised"
          >
            <Pencil size={11} />
            Editar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-surface-border bg-surface-raised px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={12} className={phaseColor} />
            <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Fase</p>
          </div>
          <p className={`text-sm font-semibold ${phaseColor}`}>{phaseLabel}</p>
        </div>

        <div className="rounded-xl border border-surface-border bg-surface-raised px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar size={12} className="text-ink-faint" />
            <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Faltan</p>
          </div>
          <p className="text-sm font-semibold text-ink">{weeksLabel}</p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-surface-border bg-surface-raised px-3 py-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint mb-1">Foco del bloque</p>
        <p className="text-xs text-ink-muted leading-relaxed">{macroPlan.blockFocus}</p>
      </div>

      {visibleSportDetails.length > 0 && (
        <div className="mt-3 rounded-xl border border-surface-border bg-surface-raised px-3 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint mb-2">Por deporte</p>
          <div className="space-y-2">
            {visibleSportDetails.map((detail) => (
              <SportDetailRow key={`${detail.sport}-${detail.role}`} detail={detail} />
            ))}
          </div>
        </div>
      )}

      {visibleTimeline.length > 0 && (
        <div className="mt-3 rounded-xl border border-surface-border bg-surface-raised px-3 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint mb-2">Timeline</p>
          <div className="space-y-2">
            {visibleTimeline.map((entry) => (
              <div
                key={`${entry.phase}-${entry.startWeek}-${entry.endWeek}`}
                className={`rounded-lg border px-2.5 py-2 ${
                  entry.isCurrent ? 'border-brand/30 bg-brand/5' : 'border-surface-border bg-surface'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-ink">{entry.label}</p>
                  <span className="text-[10px] text-ink-faint">
                    {formatTimelineRange(entry.startWeek, entry.endWeek)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-ink-muted leading-relaxed">{entry.focus}</p>
                {entry.eventMarkers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entry.eventMarkers.map((eventMarker) => (
                      <span
                        key={eventMarker.id}
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          eventMarker.priority === 'secondary'
                            ? 'bg-surface-border/60 text-ink-muted'
                            : 'bg-brand/10 text-brand-light'
                        }`}
                      >
                        {eventMarker.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-2 text-[10px] text-ink-faint">
        {macroPlan.goalEventDate} · Actualizado al guardar perfil
      </p>
    </Card>
  )
}

function SportDetailRow({ detail }: { detail: MacroPlanSportDetail }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink">{SPORT_LABELS[detail.sport] ?? detail.sport}</p>
        <span className={`text-[10px] uppercase tracking-wide ${
          detail.role === 'primary' ? 'text-brand-light' : 'text-amber-300'
        }`}>
          {detail.role === 'primary' ? 'principal' : 'soporte'}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-ink leading-relaxed">{detail.phaseFocus}</p>
      <p className="mt-0.5 text-[10px] text-ink-muted leading-relaxed">{detail.weeklyIntent}</p>
    </div>
  )
}

function formatTimelineRange(startWeek: number, endWeek: number): string {
  if (startWeek < 0 && endWeek < 0) return 'post-evento'
  if (startWeek === 0 && endWeek === 0) return 'esta semana'
  if (startWeek === endWeek) return `sem ${startWeek}`
  return `sem ${startWeek}-${endWeek}`
}
