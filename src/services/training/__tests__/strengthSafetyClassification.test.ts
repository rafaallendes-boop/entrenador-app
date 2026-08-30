import { describe, expect, it } from 'vitest'
import { STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'

const byId = (id: string) => {
  const exercise = STRENGTH_EXERCISE_LIBRARY.find((candidate) => candidate.id === id)
  if (!exercise) throw new Error(`id inexistente: ${id}`)
  return exercise
}

describe('clasificación de seguridad de fuerza', () => {
  it('clasifica los 77 ejercicios con al menos una región', () => {
    expect(STRENGTH_EXERCISE_LIBRARY).toHaveLength(77)
    for (const exercise of STRENGTH_EXERCISE_LIBRARY) expect(exercise.safety.loadsRegions.length).toBeGreaterThan(0)
  })

  it('conserva las decisiones cervical y sacroilíaca explícitas', () => {
    expect(byId('farmer_carry').safety.loadsRegions).toEqual(expect.arrayContaining(['cervical', 'pelvis_sacroiliac']))
    expect(byId('overhead_press').safety.loadsRegions).toContain('cervical')
    expect(byId('bb_side_lunge').safety.loadsRegions).toContain('pelvis_sacroiliac')
    expect(byId('lat_pulldown').safety.loadsRegions).not.toContain('pelvis_sacroiliac')
  })

  it('no presenta dead bug como universalmente seguro', () => {
    expect(byId('dead_bug').safety.loadsRegions).toEqual(expect.arrayContaining(['lumbar', 'trunk_core']))
  })
})
