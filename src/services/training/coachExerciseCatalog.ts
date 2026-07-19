import type { SessionType } from '../../types'
import type { ExerciseLibraryRef, ExerciseLibrarySource } from '../../types/exerciseLibraryRef'
import { SQUASH_DRILL_LIBRARY, type DrillCategory } from './drillLibrary'
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
  searchText: buildSearchText([drill.name, ...drill.tags, ...drill.focus]),
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
  searchText: buildSearchText([exercise.name, ...(exercise.aliases ?? []), ...exercise.tags]),
  defaults: { ...STRENGTH_DEFAULTS[exercise.intensityType] },
}))

/** Sesión de squash ve drills + fuerza (accesorio común); fuerza solo fuerza; el resto nada. */
export function getCatalogForSport(type: SessionType): CatalogEntry[] {
  if (type === 'squash') return [...SQUASH_ENTRIES, ...STRENGTH_ENTRIES]
  if (type === 'strength') return STRENGTH_ENTRIES
  return []
}

export function searchCatalog(type: SessionType, query: string): CatalogEntry[] {
  const normalized = normalizeCatalogText(query)
  if (!normalized) return []

  const terms = normalized.split(/\s+/)
  return getCatalogForSport(type).filter((entry) =>
    terms.every((term) => entry.searchText.includes(term)),
  )
}

export function toLibraryRef(entry: CatalogEntry): ExerciseLibraryRef {
  return { source: entry.source, id: entry.libraryId }
}
