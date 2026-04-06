import { useState } from 'react'
import type { QuickAction, SupportedSport } from '../../types'

const SPORT_LABELS: Record<SupportedSport, string> = {
  squash: 'squash',
  running: 'running',
  cycling: 'ciclismo',
  strength: 'fuerza',
  mobility: 'movilidad',
}

const BASE_QUICK_ACTIONS: QuickAction[] = [
  { id: 'create_week', label: 'Crear semana',          prompt: '' },
  { id: 'adjust',      label: 'Ajustar semana',        prompt: 'Necesito ajustar mi semana de entrenamiento' },
  { id: 'reduce',      label: 'Bajar carga',            prompt: 'Quiero bajar la carga esta semana, me siento cansado' },
]

const TAIL_QUICK_ACTIONS: QuickAction[] = [
  { id: 'reorder',     label: 'Reordenar sesiones',     prompt: 'Ayúdame a reordenar las sesiones de esta semana' },
  { id: 'nutrition',   label: 'Foco nutricional',       prompt: 'Dame un foco nutricional para esta semana según mi entrenamiento' },
]

interface QuickActionChipsProps {
  onSelect: (prompt: string) => void
  disabled?: boolean
  enabledSports?: SupportedSport[]
}

export default function QuickActionChips({ onSelect, disabled, enabledSports = [] }: QuickActionChipsProps) {
  const [weekPicker, setWeekPicker] = useState(false)

  // Build dynamic sport chips (exclude mobility, max 2)
  const sportChips: QuickAction[] = enabledSports
    .filter(s => s !== 'mobility')
    .slice(0, 2)
    .map(s => ({
      id: `prioritize_${s}`,
      label: `Priorizar ${SPORT_LABELS[s]}`,
      prompt: `Créame una semana priorizando ${SPORT_LABELS[s]}`,
    }))

  const allActions = [...BASE_QUICK_ACTIONS, ...sportChips, ...TAIL_QUICK_ACTIONS]

  const handleAction = (action: QuickAction) => {
    if (action.id === 'create_week') {
      setWeekPicker(true)
      return
    }
    onSelect(action.prompt)
  }

  if (weekPicker) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-muted flex-shrink-0">¿Para qué semana?</span>
        <button
          onClick={() => { setWeekPicker(false); onSelect('Créame una semana de entrenamiento para esta semana') }}
          disabled={disabled}
          className="flex-shrink-0 px-3 py-1.5 rounded-pill text-xs font-medium bg-brand/15 border border-brand/30 text-brand-light hover:bg-brand/25 transition-colors disabled:opacity-40"
        >
          Esta semana
        </button>
        <button
          onClick={() => { setWeekPicker(false); onSelect('Créame una semana de entrenamiento para la próxima semana') }}
          disabled={disabled}
          className="flex-shrink-0 px-3 py-1.5 rounded-pill text-xs font-medium bg-brand/15 border border-brand/30 text-brand-light hover:bg-brand/25 transition-colors disabled:opacity-40"
        >
          Próxima semana
        </button>
        <button
          onClick={() => setWeekPicker(false)}
          className="flex-shrink-0 px-2 py-1.5 rounded-pill text-xs text-ink-faint hover:text-ink-muted transition-colors"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
      {allActions.map(action => (
        <button
          key={action.id}
          onClick={() => handleAction(action)}
          disabled={disabled}
          className="flex-shrink-0 px-3 py-1.5 rounded-pill text-xs font-medium bg-surface-raised border border-surface-border text-ink-muted hover:border-brand/40 hover:text-ink transition-colors disabled:opacity-40"
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
