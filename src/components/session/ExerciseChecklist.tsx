import { Check } from 'lucide-react'
import type { Exercise, Session, WarmupSet } from '../../types'
import { useTrainingStore } from '../../store/useTrainingStore'
import { resolveStrengthExerciseBlock } from '../../services/training/strengthSessionStructure'

interface ExerciseChecklistProps {
  sessionId: string
  exercises: Exercise[]
  sessionType?: Session['type']
}

type DisplayBlock = 'core' | 'strength' | 'cardio' | 'mobility'

const BLOCK_LABEL: Record<DisplayBlock, string> = {
  core: 'Zona media',
  strength: 'Trabajo de fuerza',
  cardio: 'Cardio especifico',
  mobility: 'Movilidad / cierre',
}

const BLOCK_TONE: Record<DisplayBlock, string> = {
  core: 'border-cyan-500/20 bg-cyan-500/5 text-cyan-300/80',
  strength: 'border-amber-500/20 bg-amber-500/5 text-amber-300/80',
  cardio: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300/80',
  mobility: 'border-violet-500/20 bg-violet-500/5 text-violet-300/80',
}

const BLOCK_ORDER: DisplayBlock[] = ['core', 'strength', 'cardio', 'mobility']

export default function ExerciseChecklist({ sessionId, exercises, sessionType }: ExerciseChecklistProps) {
  const toggleExercise = useTrainingStore(s => s.toggleExercise)
  const sections = sessionType === 'strength'
    ? groupStrengthExercises(exercises)
    : [{ block: undefined, exercises }]

  return (
    <div className="mt-3 space-y-3">
      {sections.map((section) => (
        <div key={section.block ?? 'flat'} className={section.block ? `rounded-lg border p-2 ${BLOCK_TONE[section.block]}` : 'space-y-3'}>
          {section.block && (
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider">{BLOCK_LABEL[section.block]}</p>
          )}
          <div className="space-y-3">
            {section.exercises.map(ex => (
              <ExerciseRow
                key={ex.id}
                exercise={ex}
                onToggle={() => toggleExercise(sessionId, ex.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ExerciseRow({ exercise: ex, onToggle }: { exercise: Exercise; onToggle: () => void }) {
  return (
    <div className="space-y-1">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 text-left group"
      >
        <div className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border transition-colors ${
          ex.completed
            ? 'bg-brand border-brand'
            : 'border-surface-border group-hover:border-brand/50'
        }`}>
          {ex.completed && <Check size={12} className="text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-sm ${ex.completed ? 'line-through text-ink-faint' : 'text-ink'}`}>
            {ex.name}
          </span>
        </div>
        <div className="text-xs text-ink-muted flex-shrink-0">
          {formatTargetSet(ex)}
        </div>
      </button>
      {ex.warmupSets && ex.warmupSets.length > 0 && (
        <div className="ml-8 pl-3 border-l border-surface-border/50 space-y-0.5">
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">aprox</span>
          {ex.warmupSets.map((set, idx) => (
            <div key={idx} className="text-xs text-ink-faint">
              {formatWarmupSet(set)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function groupStrengthExercises(exercises: Exercise[]): Array<{ block: DisplayBlock; exercises: Exercise[] }> {
  const groups = new Map<DisplayBlock, Exercise[]>()

  for (const exercise of exercises) {
    const block = toDisplayBlock(resolveStrengthExerciseBlock(exercise))
    groups.set(block, [...(groups.get(block) ?? []), exercise])
  }

  return BLOCK_ORDER
    .map((block) => ({ block, exercises: groups.get(block) ?? [] }))
    .filter((section) => section.exercises.length > 0)
}

function toDisplayBlock(group: ReturnType<typeof resolveStrengthExerciseBlock>): DisplayBlock {
  if (group === 'core') return 'core'
  if (group === 'cardio') return 'cardio'
  if (group === 'mobility') return 'mobility'
  return 'strength'
}

function formatTargetSet(ex: Exercise): string {
  const base = `${ex.sets}×${ex.reps}`
  if (ex.weight != null) {
    const pct = ex.targetPercent1RM != null ? ` (${Math.round(ex.targetPercent1RM)}% 1RM)` : ''
    return `${base} · ${ex.weight}kg${pct}`
  }
  if (ex.targetRpe != null) {
    return `${base} · RPE ${ex.targetRpe}`
  }
  return base
}

function formatWarmupSet(set: WarmupSet): string {
  const parts: string[] = [`${set.reps}`]
  if (set.weight != null) {
    parts.push(`${set.weight}kg`)
  }
  if (set.percent1RM != null) {
    parts.push(`${Math.round(set.percent1RM)}%`)
  }
  return parts.join(' · ')
}
