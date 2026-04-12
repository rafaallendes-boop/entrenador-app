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
  const quickFuelItems = [
    rec.preWorkout ? { label: 'Pre sesion', tone: 'neutral', value: rec.preWorkout } : null,
    rec.preTraining ? { label: 'Pre entreno', tone: 'amber', value: rec.preTraining } : null,
    rec.postWorkout ? { label: 'Post sesion', tone: 'neutral', value: rec.postWorkout } : null,
    rec.postTraining ? { label: 'Post entreno', tone: 'emerald', value: rec.postTraining } : null,
  ].filter((item): item is { label: string; tone: 'neutral' | 'amber' | 'emerald'; value: string } => Boolean(item))

  const expandedToneClasses: Record<'neutral' | 'amber' | 'emerald', string> = {
    neutral: 'bg-surface-raised border border-surface-border',
    amber: 'bg-amber-500/8 border border-amber-500/15',
    emerald: 'bg-emerald-500/8 border border-emerald-500/15',
  }

  const expandedLabelClasses: Record<'neutral' | 'amber' | 'emerald', string> = {
    neutral: 'text-ink-faint',
    amber: 'text-amber-400',
    emerald: 'text-emerald-400',
  }

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
      {quickFuelItems.length > 0 && !expanded && (
        <div className={`px-4 pb-3 grid gap-2 ${quickFuelItems.length > 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2'}`}>
          {quickFuelItems.map((item) => (
            <div key={`${item.label}-${item.value}`} className="bg-surface-raised rounded-lg p-2">
              <p className="text-[10px] text-ink-faint font-semibold uppercase tracking-wider mb-1">{item.label}</p>
              <p className="text-xs text-ink-muted leading-snug line-clamp-2">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Expanded: full menu */}
      {expanded && (
        <div className="border-t border-surface-border">
          {/* Pre/post workout */}
          {quickFuelItems.length > 0 && (
            <div className={`px-4 py-3 grid gap-2 ${quickFuelItems.length > 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2'}`}>
              {quickFuelItems.map((item) => (
                <div key={`${item.label}-${item.value}`} className={`${expandedToneClasses[item.tone]} rounded-lg p-2.5`}>
                  <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${expandedLabelClasses[item.tone]}`}>{item.label}</p>
                  <p className="text-xs text-ink-muted leading-snug">{item.value}</p>
                </div>
              ))}
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
