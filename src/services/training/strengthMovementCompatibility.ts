import type { ExerciseDefinition } from './exerciseLibrary'

/** Una zancada exige apoyo unilateral de piernas, no sólo asimetría. */
export function isLungeStrengthExercise(exercise: ExerciseDefinition): boolean {
  return exercise.category === 'lower'
    && exercise.isolation !== true
    && exercise.intensityType !== 'power'
    && (exercise.movement === 'squat' || exercise.movement === 'locomotion')
    && (exercise.unilateral === true || exercise.tags.includes('court_lunge') || exercise.tags.includes('lateral_strength'))
}
