import { describe, expect, it } from 'vitest'

import {
  findStrengthExerciseByName,
  resolveStrengthExerciseName,
  STRENGTH_EXERCISE_LIBRARY,
} from '../exerciseLibrary'

/**
 * Contrato de resolución (spec 2026-07-31 §3.2).
 *
 *   id o nombre canónico exacto
 *     → alias exacto
 *       → único candidato por substring
 *         → ambiguo (sin definición, con candidatos)
 *
 * La ambigüedad rechaza SOLO en el último escalón. Un alias declarado nunca
 * queda sin resolver por ser ambiguo, porque no llega a esa rama.
 *
 * Un fragmento ambiguo no entrega definición —eso mantiene la carga
 * fail-closed— pero sí entrega los candidatos, porque clasificar la sesión no
 * es fail-closed (spec §2) y tirarlos degradaba el bloque a `other`.
 */
describe('resolución de nombres de ejercicios', () => {
  it('cada nombre canónico resuelve a su propio id', () => {
    const offenders = STRENGTH_EXERCISE_LIBRARY
      .filter((definition) => findStrengthExerciseByName(definition.name)?.id !== definition.id)
      .map((definition) => definition.id)
    expect(offenders).toEqual([])
  })

  it('cada alias declarado resuelve a su propio id', () => {
    const offenders: string[] = []
    for (const definition of STRENGTH_EXERCISE_LIBRARY) {
      for (const alias of definition.aliases ?? []) {
        if (findStrengthExerciseByName(alias)?.id !== definition.id) {
          offenders.push(`${definition.id} ← "${alias}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('un alias exacto gana sobre la ambigüedad por substring', () => {
    // "Sentadilla" está en `back_squat.aliases` y en el aliasMap interno, y a la
    // vez es substring de 8 ejercicios. Resuelve por alias, no se rechaza.
    expect(findStrengthExerciseByName('Sentadilla')?.id).toBe('back_squat')
    expect(findStrengthExerciseByName('Dominadas')?.id).toBe('pull_up')
  })

  it('un fragmento que empata entre varios ejercicios no resuelve', () => {
    expect(findStrengthExerciseByName('press')).toBeUndefined()
    expect(findStrengthExerciseByName('remo')).toBeUndefined()
  })

  it('un texto sin relación con el catálogo no resuelve', () => {
    expect(findStrengthExerciseByName('Circuito experimental alfa')).toBeUndefined()
  })

  it('expone la procedencia para no confundir substring con identidad', () => {
    expect(resolveStrengthExerciseName('Sentadilla trasera con barra')?.matchKind).toBe('exact')
    expect(resolveStrengthExerciseName('Barbell back squat')?.matchKind).toBe('alias')
    expect(resolveStrengthExerciseName('Press de banca')?.matchKind).toBe('alias')
    expect(resolveStrengthExerciseName('Estiramiento de sentadilla profunda')).toMatchObject({
      definition: { id: 'back_squat' },
      matchKind: 'substring',
    })
  })

  it('un fragmento ambiguo conserva sus candidatos ordenados por id', () => {
    const resolution = resolveStrengthExerciseName('Dominada lastrada progresiva')

    expect(resolution?.matchKind).toBe('ambiguous')
    expect(resolution?.definition).toBeUndefined()
    expect(resolution?.candidates.map((candidate) => candidate.id)).toEqual([
      'pull_up',
      'weighted_pull_up',
    ])
  })

  it('un texto sin relación con el catálogo no trae candidatos', () => {
    expect(resolveStrengthExerciseName('Circuito experimental alfa')).toBeUndefined()
  })

  it('una resolución con definición se lista a sí misma como único candidato', () => {
    expect(resolveStrengthExerciseName('Press banca')?.candidates.map((c) => c.id)).toEqual(['bench_press'])
  })
})
