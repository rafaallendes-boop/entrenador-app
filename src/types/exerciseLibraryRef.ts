export const EXERCISE_LIBRARY_SOURCES = ['squash_drill', 'strength_exercise', 'running_template'] as const

export type ExerciseLibrarySource = (typeof EXERCISE_LIBRARY_SOURCES)[number]

/** Referencia opcional de un ejercicio de sesión a una entrada de las librerías curadas. */
export interface ExerciseLibraryRef {
  source: ExerciseLibrarySource
  id: string
}

/**
 * Sanitizador de límite (import de backup, drafts de plantilla): un ref inválido
 * se descarta sin invalidar el ejercicio que lo contiene.
 */
export function sanitizeExerciseLibraryRef(value: unknown): ExerciseLibraryRef | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined

  const record = value as Record<string, unknown>
  if (!(EXERCISE_LIBRARY_SOURCES as readonly string[]).includes(record.source as string)) {
    return undefined
  }
  if (typeof record.id !== 'string' || !record.id.trim()) return undefined

  return {
    source: record.source as ExerciseLibrarySource,
    id: record.id,
  }
}
