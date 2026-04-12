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
  const preFuel = rec.preTraining ?? rec.preWorkout
  const postFuel = rec.postTraining ?? rec.postWorkout

  return (
    <div className={`rounded-card border ${colorClasses.split(' ').find(c => c.startsWith('border')) ?? 'border-surface-border'} bg-surface-card overflow-hidden`}>
      {/* Header */}
      <button
        className="w-full flex items-start gap-3 p-4 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClasses.split(' ').filter(c => c.startsWith('bg') || c.startsWith('text')).join(' ')}`}>
          <Apple size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
              Nutrición hoy
            </span>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colorClasses}`}>
                {getLoadTypeLabel(rec.loadType)}
              </span>
              {expanded ? <ChevronUp size={14} className="text-ink-faint" /> : <ChevronDown size={14} className="text-ink-faint" />}
            </div>
          </div>
          <p className="text-sm text-ink mt-1 leading-snug">{rec.dailyFocus}</p>
        </div>
      </button>

      {/* Protein target + hydration always visible */}
      <div className="px-4 pb-3 -mt-1 space-y-1.5">
        {rec.proteinTarget && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-violet-400">{rec.proteinTarget}</span>
            <span className="text-[10px] text-ink-faint">objetivo del día</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Droplets size={13} className="text-sky-400 flex-shrink-0" />
          <span className="text-xs text-ink-muted">{rec.hydration}</span>
        </div>
      </div>

      {/* Pre/post workout quick view */}
      {(preFuel || postFuel) && !expanded && (
        <div className="px-4 pb-3 grid grid-cols-2 gap-2">
          {preFuel && (
            <div className="bg-surface-raised rounded-lg p-2">
              <p className="text-[10px] text-ink-faint font-semibold uppercase tracking-wider mb-1">Pre</p>
              <p className="text-xs text-ink-muted leading-snug line-clamp-2">{preFuel}</p>
            </div>
          )}
          {postFuel && (
            <div className="bg-surface-raised rounded-lg p-2">
              <p className="text-[10px] text-ink-faint font-semibold uppercase tracking-wider mb-1">Post</p>
              <p className="text-xs text-ink-muted leading-snug line-clamp-2">{postFuel}</p>
            </div>
          )}
        </div>
      )}

      {/* Expanded: full menu */}
      {expanded && (
        <div className="border-t border-surface-border">
          {/* Pre/post workout */}
          {(preFuel || postFuel) && (
            <div className="px-4 py-3 grid grid-cols-2 gap-2">
              {preFuel && (
                <div className="bg-amber-500/8 border border-amber-500/15 rounded-lg p-2.5">
                  <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-1">Pre entreno</p>
                  <p className="text-xs text-ink-muted leading-snug">{preFuel}</p>
                </div>
              )}
              {postFuel && (
                <div className="bg-emerald-500/8 border border-emerald-500/15 rounded-lg p-2.5">
                  <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mb-1">Post entreno</p>
                  <p className="text-xs text-ink-muted leading-snug">{postFuel}</p>
                </div>
              )}
            </div>
          )}

          {/* Full day menu */}
          <div className="px-4 pb-4 space-y-2">
            <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider">Menú del día</p>
            {[
              { label: 'Desayuno', value: rec.breakfast },
              { label: 'Almuerzo', value: rec.lunch },
              { label: 'Colación', value: rec.snack },
              { label: 'Cena', value: rec.dinner },
            ].map(({ label, value }) => (
              <div key={label} className="flex gap-3 items-start">
                <span className="text-xs text-ink-faint w-16 flex-shrink-0 pt-0.5">{label}</span>
                <span className="text-xs text-ink leading-relaxed">{value}</span>
              </div>
            ))}
          </div>

          {/* Dietary notes from profile */}
          {rec.dietaryNotes && (
            <div className="px-4 pb-4 pt-1 border-t border-surface-border">
              <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-1">
                Tus preferencias
              </p>
              <p className="text-xs text-ink-muted leading-relaxed">{rec.dietaryNotes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
