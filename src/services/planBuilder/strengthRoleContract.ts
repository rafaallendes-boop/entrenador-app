import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
import { resolveStrengthExercise } from '../training/exerciseLibrary'
import { getStrengthExerciseKey } from '../training/strengthExerciseProposal'

/**
 * Contrato de rol para el check de repetición y para la rotación de accesorios.
 * NO reemplaza `getStrengthExerciseRole` de exerciseLibrary, que es posicional y
 * la consume `strengthSelector`. Las dos coexisten a propósito, con dueños
 * distintos: unificarlas arrastraría al selector a un cambio de scoring.
 *
 * Reglas, en orden, por sesión:
 *   1. core            -> trunk    (contable)
 *   2. power           -> power    (contable)
 *   3. primer restante reconocido por catálogo -> main_lift (EXENTO)
 *   4. siguientes      -> accessory (contable)
 *   5. desconocido     -> unknown  (contable; nunca exento)
 */
export type StrengthContractRole = 'main_lift' | 'accessory' | 'trunk' | 'power' | 'unknown'

export function isCountableRole(role: StrengthContractRole): boolean {
  return role !== 'main_lift'
}

export function resolveSessionStrengthRoles(
  exercises: ReadonlyArray<{ name: string; libraryRef?: ExerciseLibraryRef }>,
): StrengthContractRole[] {
  let mainLiftTaken = false

  return exercises.map((exercise) => {
    const definition = resolveStrengthExercise(exercise)?.definition
    if (!definition) return 'unknown'
    if (definition.category === 'core') return 'trunk'
    if (definition.intensityType === 'power') return 'power'
    if (!mainLiftTaken) {
      mainLiftTaken = true
      return 'main_lift'
    }
    return 'accessory'
  })
}

type StrengthSessionLike = {
  sessionType?: string
  exercises?: ReadonlyArray<{ name: string; libraryRef?: ExerciseLibraryRef }>
}

/** Nombres que aparecen AL MENOS UNA VEZ en posición no principal. */
export function collectCountableKeys(sessions: ReadonlyArray<StrengthSessionLike>): Set<string> {
  const keys = new Set<string>()
  for (const session of sessions) {
    if (session.sessionType !== 'strength') continue
    const exercises = session.exercises ?? []
    const roles = resolveSessionStrengthRoles(exercises)
    exercises.forEach((exercise, index) => {
      if (!isCountableRole(roles[index]!)) return
      const key = getStrengthExerciseKey(exercise)
      if (key) keys.add(key)
    })
  }
  return keys
}

/** Todos los nombres de fuerza, sin distinción de rol. */
export function collectAllStrengthKeys(sessions: ReadonlyArray<StrengthSessionLike>): Set<string> {
  const keys = new Set<string>()
  for (const session of sessions) {
    if (session.sessionType !== 'strength') continue
    for (const exercise of session.exercises ?? []) {
      const key = getStrengthExerciseKey(exercise)
      if (key) keys.add(key)
    }
  }
  return keys
}
