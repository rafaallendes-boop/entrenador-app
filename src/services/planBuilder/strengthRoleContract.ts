import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
import { resolveStrengthExercise } from '../training/exerciseLibrary'
import { getStrengthExerciseKey } from '../training/strengthExerciseProposal'
import { normalizeSupersetGroups } from '../training/supersetGroups'

/**
 * Contrato de rol para el check de repetición y para la rotación de accesorios.
 * NO reemplaza `getStrengthExerciseRole` de exerciseLibrary, que es posicional y
 * la consume `strengthSelector`. Las dos coexisten a propósito, con dueños
 * distintos: unificarlas arrastraría al selector a un cambio de scoring.
 *
 * Reglas, en orden, por sesión:
 *   1. core            -> trunk    (contable)
 *   2. power           -> power    (contable)
 *   3. seguidor de un grupo (cualquier miembro que no sea el primero de su
 *      segmento) -> accessory (contable; pierde elegibilidad para main_lift)
 *   4. primer líder restante reconocido por catálogo -> main_lift (EXENTO)
 *   5. siguientes      -> accessory (contable)
 *   6. desconocido     -> unknown  (contable; nunca exento)
 *
 * Un core o un power dentro de un grupo CONSERVAN su rol: la regla de
 * seguidor solo bloquea la elegibilidad para main_lift, así que no se abre un
 * agujero de exención.
 */
export type StrengthContractRole = 'main_lift' | 'accessory' | 'trunk' | 'power' | 'unknown'

export function isCountableRole(role: StrengthContractRole): boolean {
  return role !== 'main_lift'
}

export function resolveSessionStrengthRoles(
  exercises: ReadonlyArray<{ name: string; libraryRef?: ExerciseLibraryRef; supersetGroup?: string }>,
): StrengthContractRole[] {
  let mainLiftTaken = false
  const isLeader = resolveLeaderFlags(exercises)

  return exercises.map((exercise, index) => {
    const definition = resolveStrengthExercise(exercise)?.definition
    if (!definition) return 'unknown'
    if (definition.category === 'core') return 'trunk'
    if (definition.intensityType === 'power') return 'power'
    if (!isLeader[index]) return 'accessory'
    if (!mainLiftTaken) {
      mainLiftTaken = true
      return 'main_lift'
    }
    return 'accessory'
  })
}

/**
 * Un ejercicio es líder si no tiene grupo, o si es el primer miembro de su
 * segmento normalizado. Se normaliza primero para que un tag corrupto no
 * fabrique seguidores fantasma.
 */
function resolveLeaderFlags(
  exercises: ReadonlyArray<{ supersetGroup?: string }>,
): boolean[] {
  const normalized = normalizeSupersetGroups(
    exercises.map((exercise) => ({ sets: 1, supersetGroup: exercise.supersetGroup })),
  )

  return normalized.map((exercise, index) => {
    if (!exercise.supersetGroup) return true
    return normalized[index - 1]?.supersetGroup !== exercise.supersetGroup
  })
}

type StrengthSessionLike = {
  sessionType?: string
  exercises?: ReadonlyArray<{
    name: string
    libraryRef?: ExerciseLibraryRef
    supersetGroup?: string
  }>
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
