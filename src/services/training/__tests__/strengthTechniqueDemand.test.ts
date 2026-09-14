import { describe, expect, it } from 'vitest'
import { STRENGTH_EXERCISE_LIBRARY, getExerciseById } from '../exerciseLibrary'

/**
 * Lista congelada de D2 (owner, 2026-09-13). Append-only y auditada por id:
 * afinarla es un cambio explícito de este archivo y del ledger, nunca un
 * efecto lateral de editar `difficulty` o `tags`.
 */
const REQUIRES_TECHNIQUE_IDS = [
  'back_squat', 'barbell_jump_squat', 'clean', 'clean_high_pull', 'deadlift',
  'depth_jump', 'drop_jump', 'front_squat', 'push_press', 'split_jerk',
] as const

describe('requiresTechnique (D2)', () => {
  it('marca exactamente la lista congelada', () => {
    const flagged = STRENGTH_EXERCISE_LIBRARY
      .filter((exercise) => exercise.requiresTechnique === true)
      .map((exercise) => exercise.id)
      .sort()
    expect(flagged).toEqual([...REQUIRES_TECHNIQUE_IDS])
  })

  it('cada id de la lista existe en el catálogo', () => {
    for (const id of REQUIRES_TECHNIQUE_IDS) expect(getExerciseById(id), id).toBeDefined()
  })

  it('un ejercicio sin la marca no declara la clave', () => {
    const plain = STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.id === 'goblet_squat')
    expect(plain).toBeDefined()
    expect(Object.prototype.hasOwnProperty.call(plain, 'requiresTechnique')).toBe(false)
  })
})
