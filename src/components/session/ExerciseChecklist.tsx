import { Check } from 'lucide-react'
import type { Exercise, Session, WarmupSet } from '../../types'
import { useTrainingStore } from '../../store/useTrainingStore'
import { resolveStrengthExerciseBlock } from '../../services/training/strengthSessionStructure'
import { describeSupersetSegment, resolveSupersetLayout, type SupersetSegment } from '../../services/training/supersetGroups'

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

interface RenderSection {
  block: DisplayBlock | undefined
  segments: SupersetSegment<Exercise>[]
}

export default function ExerciseChecklist({ sessionId, exercises, sessionType }: ExerciseChecklistProps) {
  const toggleExercise = useTrainingStore(s => s.toggleExercise)
  const sections: RenderSection[] = sessionType === 'strength'
    ? groupStrengthExercises(exercises)
    : [{
        block: undefined,
        segments: exercises.length > 0 ? [{ groupId: undefined, members: exercises }] : [],
      }]

  let groupLetterIndex = 0

  return (
    <div className="mt-3 space-y-3">
      {sections.map((section) => (
        <div key={section.block ?? 'flat'} className={section.block ? `rounded-lg border p-2 ${BLOCK_TONE[section.block]}` : 'space-y-3'}>
          {section.block && (
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider">{BLOCK_LABEL[section.block]}</p>
          )}
          <div className="space-y-3">
            {section.segments.map((segment) => {
              const letter = segment.groupId ? String.fromCharCode(65 + groupLetterIndex++) : undefined
              return (
                <div
                  key={segment.groupId ?? segment.members[0]!.id}
                  className={segment.groupId
                    ? 'space-y-2 border-l-2 border-brand/40 pl-3'
                    : 'space-y-3'}
                >
                  {letter && (
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand-light/90">
                      {`${letter} · ${describeSupersetSegment(segment.members.length)} · ${segment.members[0]!.sets} rondas`}
                    </p>
                  )}
                  {segment.members.map(ex => (
                    <ExerciseRow
                      key={ex.id}
                      exercise={ex}
                      grouped={segment.groupId != null}
                      onToggle={() => toggleExercise(sessionId, ex.id)}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function ExerciseRow({ exercise: ex, grouped, onToggle }: { exercise: Exercise; grouped?: boolean; onToggle: () => void }) {
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
          {grouped ? formatGroupedTargetSet(ex) : formatTargetSet(ex)}
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

function groupStrengthExercises(exercises: Exercise[]): RenderSection[] {
  const segments = resolveSupersetLayout(exercises)
  const byBlock = new Map<DisplayBlock, SupersetSegment<Exercise>[]>()

  for (const segment of segments) {
    // El segmento entero va al bloque de su LIDER: nunca se parte.
    const block = toDisplayBlock(resolveStrengthExerciseBlock(segment.members[0]!))
    byBlock.set(block, [...(byBlock.get(block) ?? []), segment])
  }

  return BLOCK_ORDER
    .map((block) => ({ block, segments: byBlock.get(block) ?? [] }))
    .filter((section) => section.segments.length > 0)
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

function formatGroupedTargetSet(ex: Exercise): string {
  // El editor persiste `reps` como string incluso cuando es un numero. Esos
  // targets siguen necesitando la unidad visible, mientras que una duracion o
  // una instruccion compuesta ("30s", "8/lado") ya se leen por si solas.
  const rawReps = String(ex.reps).trim()
  const base = typeof ex.reps === 'number' || /^\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?$/.test(rawReps)
    ? `${rawReps} reps`
    : rawReps
  if (ex.weight != null) {
    const pct = ex.targetPercent1RM != null ? ` (${Math.round(ex.targetPercent1RM)}% 1RM)` : ''
    return `${base} · ${ex.weight}kg${pct}`
  }
  if (ex.targetRpe != null) return `${base} · RPE ${ex.targetRpe}`
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
