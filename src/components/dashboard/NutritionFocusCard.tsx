import { useState } from 'react'
import { ChevronDown, ChevronUp, Droplets, Apple } from 'lucide-react'
import type { NutritionRec } from '../../types'
import { getLoadTypeLabel, getLoadTypeColor } from '../../services/nutritionEngine'

interface NutritionFocusCardProps {
  rec: NutritionRec
  compact?: boolean
}

export default function NutritionFocusCard({ rec }: NutritionFocusCardProps) {
  const [expanded, setExpanded] = useState(false)
  const colorClasses = getLoadTypeColor(rec.loadType)

  return (
    <div className={`rounded-card border ${colorClasses.split(' ').find((item) => item.startsWith('border')) ?? 'border-surface-border'} bg-surface-card overflow-hidden`}>
      <button
        className="w-full flex items-start gap-3 p-4 text-left"
        onClick={() => setExpanded((value) => !value)}
      >
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClasses.split(' ').filter((item) => item.startsWith('bg') || item.startsWith('text')).join(' ')}`}>
          <Apple size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Nutrición hoy</span>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colorClasses}`}>
                {getLoadTypeLabel(rec.loadType)}
              </span>
              {expanded ? <ChevronUp size={14} className="text-ink-faint" /> : <ChevronDown size={14} className="text-ink-faint" />}
            </div>
          </div>
          <p className="text-sm text-ink mt-1 leading-snug">{rec.mainFocus}</p>
          <p className="mt-1 text-xs text-amber-300">{rec.keyAction}</p>
          <p className="mt-1 text-xs text-ink-muted">{rec.whyItMatters}</p>
        </div>
      </button>

      <div className="px-4 pb-3 -mt-1 space-y-2">
        {rec.proteinTarget && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-amber-400">{rec.proteinTarget}</span>
            <span className="text-[10px] text-ink-faint">objetivo del día</span>
          </div>
        )}
        <div className="flex items-start gap-2">
          <Droplets size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
          <span className="text-xs text-ink-muted">{rec.hydrationGuidance.summary}</span>
        </div>
        {rec.preWorkoutGuidance && !expanded && (
          <div className="rounded-lg bg-surface-raised p-2">
            <p className="text-[10px] text-ink-faint font-semibold uppercase tracking-wider mb-1">Antes</p>
            <p className="text-xs text-ink-muted leading-snug line-clamp-2">{rec.preWorkoutGuidance.summary}</p>
          </div>
        )}
        {rec.postWorkoutGuidance && !expanded && (
          <div className="rounded-lg bg-surface-raised p-2">
            <p className="text-[10px] text-ink-faint font-semibold uppercase tracking-wider mb-1">Después</p>
            <p className="text-xs text-ink-muted leading-snug line-clamp-2">{rec.postWorkoutGuidance.summary}</p>
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t border-surface-border px-4 py-3 space-y-3">
          {rec.mealTiming.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider">Timing clave</p>
              {rec.mealTiming.map((item) => (
                <div key={`${item.label}-${item.window}`} className="rounded-lg border border-surface-border bg-surface-raised px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                    {item.label} · {item.window}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted leading-snug">{item.summary}</p>
                </div>
              ))}
            </div>
          )}

          {rec.recoveryNote && (
            <div>
              <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-1">Recuperación</p>
              <p className="text-xs text-ink-muted leading-relaxed">{rec.recoveryNote}</p>
            </div>
          )}

          <div>
            <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-1">Por qué hoy es distinto</p>
            <p className="text-xs text-ink-muted leading-relaxed">{rec.reasoning.summary}</p>
          </div>

          {rec.dietaryNotes && (
            <div className="pt-2 border-t border-surface-border">
              <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-1">Tus preferencias</p>
              <p className="text-xs text-ink-muted leading-relaxed">{rec.dietaryNotes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
