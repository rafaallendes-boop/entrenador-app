import { Target, Calendar, TrendingUp } from 'lucide-react'
import type { MacroPlan } from '../../types'
import { getPhaseLabel, formatWeeksRemaining } from '../../services/macroPlan'
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
}

export default function MacroPlanCard({ macroPlan, eventTitle }: MacroPlanCardProps) {
  const phaseLabel = getPhaseLabel(macroPlan.currentPhase)
  const weeksLabel = formatWeeksRemaining(macroPlan.weeksRemaining)
  const phaseColor = PHASE_COLOR[macroPlan.currentPhase]
  const phaseBg = PHASE_BG[macroPlan.currentPhase]

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

      <p className="mt-2 text-[10px] text-ink-faint">
        {macroPlan.goalEventDate} · Actualizado al guardar perfil
      </p>
    </Card>
  )
}
