import { useState } from 'react'
import type { QuickAction } from '../../types'

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'create_week', label: 'Crear semana',          prompt: '' },
  { id: 'adjust',      label: 'Ajustar semana',        prompt: 'Necesito ajustar mi semana de entrenamiento' },
  { id: 'reduce',      label: 'Bajar carga',            prompt: 'Quiero bajar la carga esta semana, me siento cansado' },
  { id: 'squash',      label: 'Priorizar squash',       prompt: 'Créame una semana priorizando squash' },
  { id: 'running',     label: 'Priorizar running',      prompt: 'Créame una semana priorizando running' },
  { id: 'reorder',     label: 'Reordenar sesiones',     prompt: 'Ayúdame a reordenar las sesiones de esta semana' },
  { id: 'nutrition',   label: 'Foco nutricional',       prompt: 'Dame un foco nutricional para esta semana según mi entrenamiento' },
]

interface QuickActionChipsProps {
  onSelect: (prompt: string) => void
  disabled?: boolean
}

export default function QuickActionChips({ onSelect, disabled }: QuickActionChipsProps) {
  const [weekPicker, setWeekPicker] = useState(false)

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
      {QUICK_ACTIONS.map(action => (
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
