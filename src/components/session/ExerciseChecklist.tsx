import { Check } from 'lucide-react'
import type { Exercise } from '../../types'
import { useTrainingStore } from '../../store/useTrainingStore'

interface ExerciseChecklistProps {
  sessionId: string
  exercises: Exercise[]
}

export default function ExerciseChecklist({ sessionId, exercises }: ExerciseChecklistProps) {
  const toggleExercise = useTrainingStore(s => s.toggleExercise)

  return (
    <div className="mt-3 space-y-2">
      {exercises.map(ex => (
        <button
          key={ex.id}
          onClick={() => toggleExercise(sessionId, ex.id)}
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
            {ex.sets}×{ex.reps}{ex.weight ? ` · ${ex.weight}kg` : ''}
          </div>
        </button>
      ))}
    </div>
  )
}
