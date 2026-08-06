import { describe, expect, it } from 'vitest'

import { normalizeStrengthSessionExercises } from '../strengthSessionStructure'

const ex = (name: string, sets: number, supersetGroup?: string) => ({
  name,
  sets,
  reps: 8,
  ...(supersetGroup ? { supersetGroup } : {}),
})

describe('orden con superseries', () => {
  it('mantiene juntos los miembros de un grupo cross-block', () => {
    const result = normalizeStrengthSessionExercises([
      ex('Plancha frontal', 4),
      ex('Clean', 4, 'g1'),
      ex('Dominadas', 4, 'g1'),
      ex('Peso muerto con trap bar', 4),
    ], { durationMin: 60 })!

    const names = result.map((e) => e.name)
    const cleanIndex = names.indexOf('Clean')

    expect(names[cleanIndex + 1]).toBe('Dominadas')
  })

  it('ordena la unidad por el bloque de su lider', () => {
    const result = normalizeStrengthSessionExercises([
      ex('Peso muerto con trap bar', 4),
      ex('Clean', 4, 'g1'),
      ex('Dominadas', 4, 'g1'),
    ], { durationMin: 60 })!

    // olympic (lider del grupo) precede a legs en BLOCK_ORDER.
    // `ensureCoreBlock` antepone un core (dead_bug) porque durationMin >= 45
    // y ninguno de los 3 ejercicios es 'core': comportamiento preexistente,
    // no introducido por este cambio (ver deviations en task-6-report.md).
    expect(result.map((e) => e.name)).toEqual(['Dead bug — control de tronco', 'Clean', 'Dominadas', 'Peso muerto con trap bar'])
  })

  it('no vuelve a correr un sort individual despues de agrupar', () => {
    const result = normalizeStrengthSessionExercises([
      ex('Clean', 4, 'g1'),
      ex('Dominadas', 4, 'g1'),
      ex('Salto al cajon', 4, 'g1'),
    ], { durationMin: 60 })!

    // Mismo motivo que el test anterior: ensureCoreBlock antepone dead_bug.
    expect(result.map((e) => e.name)).toEqual(['Dead bug — control de tronco', 'Clean', 'Dominadas', 'Salto al cajon'])
  })

  it('conserva un grupo manual cuando la normalizacion reemplaza su core lider', () => {
    const result = normalizeStrengthSessionExercises([
      ex('Press Pallof', 4, 'g1'),
      ex('Corte diagonal en polea', 4, 'g1'),
      ex('Peso muerto con trap bar', 4),
    ], { durationMin: 60 })!

    const grouped = result.filter((exercise) => exercise.supersetGroup === 'g1')
    expect(grouped.map((exercise) => exercise.name)).toEqual([
      'Dead bug — control de tronco',
      'Corte diagonal en polea',
    ])
    expect(grouped.map((exercise) => exercise.sets)).toEqual([4, 4])
  })
})

describe('paridad sin grupos', () => {
  const CORPUS: Array<Array<ReturnType<typeof ex>>> = [
    [ex('Peso muerto con trap bar', 4), ex('Plancha frontal', 3), ex('Remo con pecho apoyado', 3)],
    [ex('Dominadas', 4), ex('Clean', 3), ex('Sentadilla trasera con barra', 4)],
    [ex('Pallof press', 3), ex('Salto al cajon', 4), ex('Press vertical', 3)],
  ]

  it('una sesion sin grupos produce el mismo orden que el comparador plano', () => {
    for (const session of CORPUS) {
      const result = normalizeStrengthSessionExercises(session, { durationMin: 60 })!

      expect(result.every((e) => e.supersetGroup === undefined)).toBe(true)
      // Se compara contra el snapshot congelado abajo, no contra una reimplementacion.
      expect(result.map((e) => e.name)).toMatchSnapshot()
    }
  })
})
