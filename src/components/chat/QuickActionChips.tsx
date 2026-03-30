import type { QuickAction } from '../../types'

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'adjust',      label: 'Ajustar semana',       prompt: 'Necesito ajustar mi semana de entrenamiento' },
  { id: 'reduce',      label: 'Bajar carga',           prompt: 'Quiero bajar la carga esta semana, me siento cansado' },
  { id: 'squash',      label: 'Priorizar squash',      prompt: 'Quiero priorizar squash esta semana' },
  { id: 'running',     label: 'Priorizar running',     prompt: 'Quiero priorizar running esta semana' },
  { id: 'reorder',     label: 'Reordenar sesiones',    prompt: 'Ayúdame a reordenar las sesiones de esta semana' },
  { id: 'nutrition',   label: 'Foco nutricional',      prompt: 'Dame un foco nutricional para esta semana según mi entrenamiento' },
]

interface QuickActionChipsProps {
  onSelect: (prompt: string) => void
  disabled?: boolean
}

export default function QuickActionChips({ onSelect, disabled }: QuickActionChipsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
      {QUICK_ACTIONS.map(action => (
        <button
          key={action.id}
          onClick={() => onSelect(action.prompt)}
          disabled={disabled}
          className="flex-shrink-0 px-3 py-1.5 rounded-pill text-xs font-medium bg-surface-raised border border-surface-border text-ink-muted hover:border-brand/40 hover:text-ink transition-colors disabled:opacity-40"
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
