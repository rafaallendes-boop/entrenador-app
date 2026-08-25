import {
  INJECTED_CORE_ROTATION,
  isFoundationCore,
  resolveInjectedCoreId,
} from '../training/strengthSessionStructure'
import { resolveStrengthExercise } from '../training/exerciseLibrary'
// `EquipmentType` se exporta desde exerciseLibrary, NO desde ../../types.
import type { EquipmentType } from '../training/exerciseLibrary'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'

/**
 * Proyección pura del core estructural, paso 2 del orden congelado de la spec.
 *
 * Existe porque `ensureCoreBlock` decide insertar o reemplazar según los cores
 * que queden en la sesión, y `normalizeStrengthSessions` vuelve a correr el
 * enriquecedor DESPUÉS de asignar: si el core se derivara de la sesión ya
 * asignada, dependería de la asignación y dejaría de ser reconstruible por
 * otro worker. Derivarlo del snapshot rompe esa circularidad.
 */
export interface StructuralCoreProjection {
  /** Índice en la lista del snapshot, o null si el slot es virtual (se antepone). */
  slotIndex: number | null
  /** Id canónico que ese slot debe tener en esta semana, o el core prescrito preservado. */
  coreId: string
}

/** Reexportación, no copia: la autoridad vive en strengthSessionStructure. */
export { INJECTED_CORE_ROTATION } from '../training/strengthSessionStructure'

export function projectStructuralCoreSlot(
  snapshotExercises: ReadonlyArray<{ name: string; libraryRef?: ExerciseLibraryRef; group?: string }>,
  weekIndexInBlock: number,
  availableEquipment?: EquipmentType[],
): StructuralCoreProjection {
  const slotIndex = snapshotExercises.findIndex((exercise) => isFoundationCore(exercise))
  const existing = slotIndex >= 0 ? snapshotExercises[slotIndex] : undefined
  const existingId = existing ? resolveStrengthExercise(existing)?.definition?.id : undefined
  const injectedCoreIds = new Set<string>(INJECTED_CORE_ROTATION)

  // Copenhagen, press de disco y otros cores de estabilidad son trabajo
  // prescrito, no un hueco que el ciclo pueda sobrescribir. Se vuelven fijos y
  // contables en la proyección para que el presupuesto siga diciendo la verdad.
  if (existingId && !injectedCoreIds.has(existingId)) {
    return { slotIndex, coreId: existingId }
  }

  return {
    slotIndex: slotIndex >= 0 ? slotIndex : null,
    coreId: resolveInjectedCoreId(weekIndexInBlock, availableEquipment),
  }
}
