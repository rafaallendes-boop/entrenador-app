import type { ExercisePhase, ExerciseRotationGroup, MovementPattern } from '../exerciseLibrary'

export type StrengthBlockPattern = MovementPattern | 'core' | 'cardio' | 'plyo' | 'lunge'

export interface StrengthBlockSlot {
  pattern: StrengthBlockPattern
  preferredRotationGroup?: ExerciseRotationGroup
  required: boolean
  minDurationMin?: number
  isStarLiftCandidate?: boolean
}

export interface StrengthBlockTemplate {
  id: string
  phase: ExercisePhase
  subTemplate: 'A' | 'B' | 'C'
  description: string
  slots: StrengthBlockSlot[]
}
