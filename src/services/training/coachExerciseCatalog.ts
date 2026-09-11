import { EQUIPMENT_LABELS } from './equipmentPresets'
import { athleticPrescriptionNotes } from './athleticTraining'
import type { SessionType, SquashSessionBlockKind } from '../../types'
import type { ExerciseLibraryRef, ExerciseLibrarySource } from '../../types/exerciseLibraryRef'
import { SQUASH_DRILL_LIBRARY, type DrillCategory } from './drillLibrary'
import { isSquashDrillKindCompatible } from './squashSessionHydrator'
import {
  STRENGTH_EXERCISE_LIBRARY,
  type ExerciseCategory,
  type IntensityType,
} from './exerciseLibrary'

export interface CatalogEntry {
  libraryId: string
  source: ExerciseLibrarySource
  sport: 'squash' | 'strength'
  name: string
  category: string
  intensity: 'low' | 'moderate' | 'high'
  description: string
  searchText: string
  defaults: { sets?: number; reps?: string; notes?: string }
}

const SQUASH_CATEGORY_LABELS: Record<DrillCategory, string> = {
  technical: 'Técnico',
  tactical: 'Táctico',
  physical: 'Físico',
  match: 'Partido',
}

const STRENGTH_CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  lower: 'Tren inferior',
  upper: 'Tren superior',
  core: 'Core',
  full_body: 'Cuerpo completo',
}

const STRENGTH_INTENSITY: Record<IntensityType, CatalogEntry['intensity']> = {
  strength: 'high',
  power: 'high',
  hypertrophy: 'moderate',
  stability: 'low',
  recovery: 'low',
}

const STRENGTH_DEFAULTS: Record<IntensityType, { sets: number; reps: string }> = {
  strength: { sets: 4, reps: '5' },
  power: { sets: 4, reps: '3' },
  hypertrophy: { sets: 3, reps: '10' },
  stability: { sets: 3, reps: '8' },
  recovery: { sets: 3, reps: '8' },
}

export function normalizeCatalogText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function buildSearchText(parts: Array<string | undefined>): string {
  return normalizeCatalogText(parts.filter(Boolean).join(' '))
}

const SQUASH_ENTRIES: CatalogEntry[] = SQUASH_DRILL_LIBRARY.map((drill) => ({
  libraryId: drill.id,
  source: 'squash_drill',
  sport: 'squash',
  name: drill.name,
  category: SQUASH_CATEGORY_LABELS[drill.category],
  intensity: drill.intensity,
  description: drill.description,
  searchText: buildSearchText([drill.name, ...(drill.aliases ?? []), ...drill.tags, ...drill.focus]),
  defaults: { sets: 3, reps: '10', notes: drill.description },
}))

const STRENGTH_ENTRIES: CatalogEntry[] = STRENGTH_EXERCISE_LIBRARY.map((exercise) => ({
  libraryId: exercise.id,
  source: 'strength_exercise',
  sport: 'strength',
  name: exercise.name,
  category: STRENGTH_CATEGORY_LABELS[exercise.category],
  intensity: STRENGTH_INTENSITY[exercise.intensityType],
  description: exercise.description,
  searchText: buildSearchText([
    exercise.name, ...(exercise.aliases ?? []), ...exercise.tags,
    ...exercise.equipment.flatMap(item => [item, EQUIPMENT_LABELS[item]]),
  ]),
  defaults: exercise.athleticPrescription ? {
    sets: exercise.athleticPrescription.sets,
    reps: String(exercise.athleticPrescription.reps),
    notes: `${exercise.description} ${athleticPrescriptionNotes(exercise)}`,
  } : exercise.prescriptionUnit === 'seconds' ? { sets: 3, reps: '30s' }
    : { ...STRENGTH_DEFAULTS[exercise.intensityType] },
}))

/** Sesión de squash ve drills + fuerza (accesorio común); fuerza solo fuerza; el resto nada. */
function filterSquashDrillsByKind(
  entries: CatalogEntry[],
  squashKind?: SquashSessionBlockKind,
): CatalogEntry[] {
  if (!squashKind) return entries
  return entries.filter((entry) => {
    if (entry.source !== 'squash_drill') return true
    const drillKind = SQUASH_DRILL_LIBRARY.find((drill) => drill.id === entry.libraryId)?.sessionKind
    // Misma autoridad que la advertencia del formulario: filtrar por igualdad
    // estricta ocultaba accesorios que el formulario aceptaría sin advertir.
    return drillKind != null && isSquashDrillKindCompatible(squashKind, drillKind)
  })
}

export function getCatalogForSport(
  type: SessionType,
  squashKind?: SquashSessionBlockKind,
): CatalogEntry[] {
  if (type === 'squash') {
    return filterSquashDrillsByKind([...SQUASH_ENTRIES, ...STRENGTH_ENTRIES], squashKind)
  }
  if (type === 'strength') return STRENGTH_ENTRIES
  return []
}

export function searchCatalog(
  type: SessionType,
  query: string,
  squashKind?: SquashSessionBlockKind,
): CatalogEntry[] {
  const normalized = normalizeCatalogText(query)
  if (!normalized) return []

  const terms = normalized.split(/\s+/)
  return getCatalogForSport(type, squashKind).filter((entry) =>
    terms.every((term) => entry.searchText.includes(term)),
  )
}

export function toLibraryRef(entry: CatalogEntry): ExerciseLibraryRef {
  return { source: entry.source, id: entry.libraryId }
}
