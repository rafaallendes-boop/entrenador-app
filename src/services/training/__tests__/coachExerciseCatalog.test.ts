import { describe, expect, it } from 'vitest'
import {
  getCatalogForSport,
  normalizeCatalogText,
  searchCatalog,
  toLibraryRef,
} from '../coachExerciseCatalog'
import { SQUASH_DRILL_LIBRARY } from '../drillLibrary'
import { STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'

describe('coachExerciseCatalog', () => {
  it('busca equipamiento declarado aunque no aparezca en el nombre', () => {
    for (const query of ['jalón máquina', 'jalón poleas', 'jalón cable']) {
      expect(searchCatalog('strength', query).map(entry => entry.libraryId)).toContain('lat_pulldown')
    }
    expect(searchCatalog('strength', 'máquinas').map(entry => entry.libraryId)).not.toContain('bench_press')
  })

  it('squash ofrece drills + fuerza; fuerza solo fuerza; otros deportes nada', () => {
    const squash = getCatalogForSport('squash')
    expect(squash).toHaveLength(SQUASH_DRILL_LIBRARY.length + STRENGTH_EXERCISE_LIBRARY.length)
    expect(squash.some((entry) => entry.source === 'squash_drill')).toBe(true)
    expect(squash.some((entry) => entry.source === 'strength_exercise')).toBe(true)

    const strength = getCatalogForSport('strength')
    expect(strength).toHaveLength(STRENGTH_EXERCISE_LIBRARY.length)
    expect(strength.every((entry) => entry.source === 'strength_exercise')).toBe(true)

    expect(getCatalogForSport('running')).toEqual([])
    expect(getCatalogForSport('mobility')).toEqual([])
    expect(getCatalogForSport('recovery')).toEqual([])
  })

  it('mapea un drill con etiqueta de categoría, defaults 3×10 y descripción como nota', () => {
    const drill = SQUASH_DRILL_LIBRARY[0]
    const entry = getCatalogForSport('squash').find(
      (candidate) => candidate.source === 'squash_drill' && candidate.libraryId === drill.id,
    )
    expect(entry).toBeDefined()
    expect(entry!.name).toBe(drill.name)
    expect(['Técnico', 'Táctico', 'Físico', 'Partido']).toContain(entry!.category)
    expect(entry!.defaults).toEqual({ sets: 3, reps: '10', notes: drill.description })
    expect(entry!.intensity).toBe(drill.intensity)
  })

  it('defaults e intensity de fuerza dependen de intensityType (incluye recovery)', () => {
    const strengthEntries = getCatalogForSport('strength')
    const byIntensity = (intensityType: string) =>
      STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.intensityType === intensityType)
    const find = (id: string) => strengthEntries.find((entry) => entry.libraryId === id)!

    const cases: Array<[string, { sets: number; reps: string }, 'low' | 'moderate' | 'high']> = [
      ['strength', { sets: 4, reps: '5' }, 'high'],
      ['power', { sets: 4, reps: '3' }, 'high'],
      ['hypertrophy', { sets: 3, reps: '10' }, 'moderate'],
      ['stability', { sets: 3, reps: '8' }, 'low'],
      ['recovery', { sets: 3, reps: '8' }, 'low'],
    ]
    for (const [intensityType, defaults, intensity] of cases) {
      const exercise = byIntensity(intensityType)
      if (!exercise) continue
      expect(find(exercise.id).defaults).toMatchObject(defaults)
      expect(find(exercise.id).intensity).toBe(intensity)
    }
    for (const entry of strengthEntries) {
      expect(['low', 'moderate', 'high']).toContain(entry.intensity)
    }
  })

  it('busca sin tildes ni mayúsculas', () => {
    expect(normalizeCatalogText('Sentadilla Búlgara')).toBe('sentadilla bulgara')
    const hits = searchCatalog('strength', 'SENTADILLA')
    expect(hits.length).toBeGreaterThan(0)
    expect(searchCatalog('strength', '')).toEqual([])
    expect(searchCatalog('running', 'sentadilla')).toEqual([])
  })

  it('matchea por alias que no está en el nombre canónico', () => {
    const hits = searchCatalog('strength', 'barbell')
    expect(hits.some((entry) => entry.libraryId === 'back_squat')).toBe(true)
  })

  it('toLibraryRef arma el ref con source e id originales', () => {
    const entry = getCatalogForSport('squash')[0]
    expect(toLibraryRef(entry)).toEqual({ source: entry.source, id: entry.libraryId })
  })

  it('el picker ofrece los accesorios de sombras que el hidratador acepta', () => {
    // El formulario sólo advierte por `isSquashDrillKindCompatible`, que admite
    // sombras como accesorio: filtrar por igualdad estricta escondía del
    // explorador drills que el propio formulario aceptaría sin advertencia.
    for (const kind of ['control', 'technical', 'match'] as const) {
      const drills = getCatalogForSport('squash', kind)
        .filter((entry) => entry.source === 'squash_drill')
        .map((entry) => SQUASH_DRILL_LIBRARY.find((drill) => drill.id === entry.libraryId)!)
      expect(drills.some((drill) => drill.sessionKind === 'shadows')).toBe(true)
      expect(drills.every((drill) => drill.sessionKind === kind || drill.sessionKind === 'shadows')).toBe(true)
    }
  })

  it('sombras no ofrece accesorios de otras modalidades', () => {
    const drills = getCatalogForSport('squash', 'shadows')
      .filter((entry) => entry.source === 'squash_drill')
      .map((entry) => SQUASH_DRILL_LIBRARY.find((drill) => drill.id === entry.libraryId)!)
    expect(drills.length).toBeGreaterThan(0)
    expect(drills.every((drill) => drill.sessionKind === 'shadows')).toBe(true)
  })

  it('las etiquetas de categoría de fuerza son las del spec', () => {
    const categories = new Set(getCatalogForSport('strength').map((entry) => entry.category))
    for (const category of categories) {
      expect(['Tren inferior', 'Tren superior', 'Core', 'Cuerpo completo']).toContain(category)
    }
  })
})
