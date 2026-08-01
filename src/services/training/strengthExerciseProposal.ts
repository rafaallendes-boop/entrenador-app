import type { CoachExerciseProposal } from '../../types'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
import { normalizeStrengthExerciseKey, resolveStrengthExercise } from './exerciseLibrary'
import type { StrengthSelectionExercise } from './strengthSelector'

/** Conversión canónica de una selección de fuerza a propuesta persistible. */
export function toStrengthProposal(exercise: StrengthSelectionExercise): CoachExerciseProposal {
  return {
    name: exercise.name,
    sets: exercise.sets,
    reps: exercise.reps,
    group: exercise.group,
    notes: exercise.notes,
    targetPercent1RM: exercise.targetPercent1RM,
    targetRpe: exercise.targetRpe,
    libraryRef: exercise.libraryRef,
  }
}

/**
 * Proyección para rutas que inmediatamente vuelven a enriquecer la propuesta.
 * Conserva la identidad nueva, pero deja que el enriquecedor derive porcentaje
 * y RPE como antes; transportar esos targets cambia pesos y warmups.
 */
export function toStrengthProposalForEnhancement(
  exercise: StrengthSelectionExercise,
): CoachExerciseProposal {
  const proposal = toStrengthProposal(exercise)
  delete proposal.targetPercent1RM
  delete proposal.targetRpe
  return proposal
}

/**
 * Proyección cerrada para el prompt. La enumeración explícita evita exponer al
 * modelo campos internos nuevos por accidente.
 */
export function toModelFacingProposal(exercise: StrengthSelectionExercise): CoachExerciseProposal {
  return {
    name: exercise.name,
    sets: exercise.sets,
    reps: exercise.reps,
    group: exercise.group,
    notes: exercise.notes ? `${exercise.notes} [${exercise.intensity}]` : `[${exercise.intensity}]`,
  }
}

/** Identidad común para rotación y deduplicación. */
export function getStrengthExerciseKey(
  exercise: { name: string; libraryRef?: ExerciseLibraryRef },
): string {
  return resolveStrengthExercise(exercise)?.definition?.id
    ?? normalizeStrengthExerciseKey(exercise.name)
}
