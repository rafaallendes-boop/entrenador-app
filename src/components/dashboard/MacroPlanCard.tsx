import { Calendar, ChevronRight, Target, Trash2, TrendingUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { MacroPlan } from '../../types'
import { formatWeeksRemaining, getPhaseLabel } from '../../services/macroPlan'
import { ROUTES } from '../../constants/routes'
import Card from '../ui/Card'

const PHASE_COLOR: Record<MacroPlan['currentPhase'], string> = {
  base:       'text-sky-400',
  build:      'text-amber-400',
  peak:       'text-orange-400',
  taper:      'text-emerald-400',
  race:       'text-rose-400',
  transition: 'text-violet-400',
}

const PHASE_DOT: Record<MacroPlan['currentPhase'], string> = {
  base:       'bg-sky-400',
  build:      'bg-amber-400',
  peak:       'bg-orange-400',
  taper:      'bg-emerald-400',
  race:       'bg-rose-400',
  transition: 'bg-violet-400',
}

const PHASE_BG: Record<MacroPlan['currentPhase'], string> = {
  base:       'bg-[linear-gradient(145deg,rgba(56,189,248,0.10),rgba(14,14,14,0.98))] border-sky-500/15',
  build:      'bg-[linear-gradient(145deg,rgba(255,235,156,0.10),rgba(14,14,14,0.98))] border-amber-500/15',
  peak:       'bg-[linear-gradient(145deg,rgba(251,146,60,0.10),rgba(14,14,14,0.98))] border-orange-500/15',
  taper:      'bg-[linear-gradient(145deg,rgba(16,185,129,0.10),rgba(14,14,14,0.98))] border-emerald-500/15',
  race:       'bg-[linear-gradient(145deg,rgba(251,113,133,0.10),rgba(14,14,14,0.98))] border-rose-500/15',
  transition: 'bg-[linear-gradient(145deg,rgba(167,139,250,0.10),rgba(14,14,14,0.98))] border-violet-500/15',
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
  const phaseDot = PHASE_DOT[macroPlan.currentPhase] ?? 'bg-ink-faint'
  const phaseBg = PHASE_BG[macroPlan.currentPhase] ?? 'bg-surface-raised border-surface-border'

  return (
    <Card variant="hud" className={`border ${phaseBg} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-white/5 bg-black/30">
          <Target size={13} className={phaseColor} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.3em] text-ink-faint">
            Objetivo principal
          </p>
          {eventTitle && (
            <p className="mt-0.5 text-sm font-semibold text-ink truncate">{eventTitle}</p>
          )}
        </div>

        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="flex-shrink-0 p-1.5 rounded-lg text-ink-faint hover:text-rose-300 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
            aria-label="Eliminar plan"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Phase + weeks chips */}
      <div className="grid grid-cols-2 gap-2 px-4 pb-3">
        <div className="rounded-xl border border-surface-border bg-surface-raised/60 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={11} className={phaseColor} />
            <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-ink-faint">Fase</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${phaseDot}`} />
            <p className={`text-sm font-bold ${phaseColor}`}>{phaseLabel}</p>
          </div>
        </div>

        <div className="rounded-xl border border-surface-border bg-surface-raised/60 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar size={11} className="text-ink-faint" />
            <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-ink-faint">Faltan</p>
          </div>
          <p className="text-sm font-bold text-ink">{weeksLabel}</p>
        </div>
      </div>

      {/* Block focus */}
      <div className="mx-4 mb-3 rounded-xl border border-surface-border bg-surface-raised/40 px-3 py-2.5">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-ink-faint mb-1">
          Foco del bloque
        </p>
        <p className="text-xs text-ink-muted leading-relaxed line-clamp-2">{macroPlan.blockFocus}</p>
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={() => navigate(ROUTES.COMPETITION_PLAN)}
        className="flex w-full items-center justify-between border-t border-surface-border/60 px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-faint">
          Ver plan completo
        </span>
        <ChevronRight size={13} className="text-ink-faint" />
      </button>
    </Card>
  )
}
