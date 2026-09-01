import { LockKeyhole } from 'lucide-react'
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
  { id: 'eat_today',   label: 'Qué comer hoy',          prompt: '¿Qué debería comer hoy según mis sesiones y mi contexto actual?' },
  { id: 'pre_workout', label: 'Pre-entreno',            prompt: 'Dame una recomendación de pre-entreno para hoy según mi sesión principal.' },
  { id: 'post_workout', label: 'Post-entreno',          prompt: '¿Qué debería priorizar en el post-entreno de hoy?' },
  { id: 'hydration',   label: 'Hidratación',            prompt: 'Ayúdame con la hidratación de hoy según mi carga y mi sesión.' },
  { id: 'fatigue_fuel', label: 'Nutrición por fatiga',  prompt: 'Ajusta mi nutrición de hoy porque vengo con fatiga o poca recuperación.' },
]

interface QuickActionChipsProps {
  onSelect: (prompt: string) => void
  onOpenPlanBuilder?: () => void
  /** Las acciones que generan una semana se ven bloqueadas y abren la oferta. */
  canCreateWeek?: boolean
  onRequireWeekCreator?: () => void
  disabled?: boolean
  enabledSports?: SupportedSport[]
}

export default function QuickActionChips({
  onSelect,
  onOpenPlanBuilder,
  canCreateWeek = true,
  onRequireWeekCreator,
  disabled,
  enabledSports = [],
}: QuickActionChipsProps) {
  const [weekPicker, setWeekPicker] = useState(false)

  // Build dynamic sport chips (exclude mobility, max 2)
  const sportChips: QuickAction[] = enabledSports
    .filter(s => s !== 'mobility')
    .slice(0, 2)
    .map(s => ({
      id: `prioritize_${s}`,
      label: `Priorizar ${SPORT_LABELS[s]}`,
      prompt: `Crea una semana de entrenamiento para esta semana, priorizando ${SPORT_LABELS[s]} dentro de los deportes permitidos. Devuelve una propuesta semanal completa para revisar y aplicar.`,
    }))

  const allActions = [...BASE_QUICK_ACTIONS, ...sportChips, ...TAIL_QUICK_ACTIONS]

  const isWeekCreatorAction = (action: QuickAction) => (
    action.id === 'create_week' || action.id.startsWith('prioritize_')
  )

  const handleAction = (action: QuickAction) => {
    if (disabled) return
    if (isWeekCreatorAction(action) && !canCreateWeek) {
      onRequireWeekCreator?.()
      return
    }
    if (action.id === 'create_week') {
      if (onOpenPlanBuilder) {
        onOpenPlanBuilder()
        return
      }
      setWeekPicker(true)
      return
    }
    onSelect(action.prompt)
  }

  if (weekPicker) {
    return (
      <div className="relative -mx-1 overflow-hidden">
        <div className="flex items-center gap-2 overflow-x-auto px-1 pb-1 scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="text-xs text-ink-muted flex-shrink-0">¿Para qué semana?</span>
          <button
            onClick={() => {
              setWeekPicker(false)
              if (!canCreateWeek) return onRequireWeekCreator?.()
              onSelect('Créame una semana de entrenamiento para esta semana')
            }}
            disabled={disabled}
            className="flex-shrink-0 px-3 py-1.5 rounded-pill text-xs font-medium bg-brand/15 border border-brand/30 text-brand-light hover:bg-brand/25 transition-colors disabled:opacity-40"
          >
            Esta semana
          </button>
          <button
            onClick={() => {
              setWeekPicker(false)
              if (!canCreateWeek) return onRequireWeekCreator?.()
              onSelect('Créame una semana de entrenamiento para la próxima semana')
            }}
            disabled={disabled}
            className="flex-shrink-0 px-3 py-1.5 rounded-pill text-xs font-medium bg-brand/15 border border-brand/30 text-brand-light hover:bg-brand/25 transition-colors disabled:opacity-40"
          >
            Próxima semana
          </button>
          <button
            onClick={() => setWeekPicker(false)}
            disabled={disabled}
            className="flex-shrink-0 px-2 py-1.5 rounded-pill text-xs text-ink-faint hover:text-ink-muted transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent" />
      </div>
    )
  }

  return (
    <div className="relative -mx-1 overflow-hidden">
      <div className="flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {allActions.map(action => (
          <button
            key={action.id}
            onClick={() => handleAction(action)}
            disabled={disabled}
            aria-disabled={isWeekCreatorAction(action) && !canCreateWeek}
            title={isWeekCreatorAction(action) && !canCreateWeek ? 'Disponible en Avanzado' : undefined}
            className="flex flex-shrink-0 items-center gap-1 px-3 py-1.5 rounded-pill text-xs font-medium bg-surface-raised border border-surface-border text-ink-muted hover:border-brand/40 hover:text-ink transition-colors disabled:opacity-40 aria-disabled:cursor-pointer aria-disabled:border-brand/25 aria-disabled:text-ink-faint"
          >
            {isWeekCreatorAction(action) && !canCreateWeek && <LockKeyhole size={11} aria-hidden />}
            {action.label}
          </button>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent" />
    </div>
  )
}
