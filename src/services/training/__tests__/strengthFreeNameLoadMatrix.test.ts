import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal, StrengthProfile } from '../../../types'
import { findStrengthExerciseByName } from '../exerciseLibrary'
import { enhanceStrengthSessionExercises } from '../strengthSessionStructure'

const PROFILE: StrengthProfile = {
  squat1RM: 100,
  deadlift1RM: 100,
  benchPress1RM: 100,
  overheadPress1RM: 100,
  pullUpMaxReps: 10,
}

function enhance(name: string) {
  const proposal: CoachExerciseProposal = { name, sets: 3, reps: 3 }
  return enhanceStrengthSessionExercises([proposal], {
    durationMin: 30,
    strengthProfile: PROFILE,
    safetyConstraints: [],
  })?.[0]
}

describe('matriz de nombres libres para carga de fuerza', () => {
  it.each([
    ['Press de banca', 'bench_press', 'benchPress', 1, 82.5],
    ['Press inclinado', 'incline_bench_press', 'benchPress', 0.85, 70],
    ['Press de hombros', 'overhead_press', 'overheadPress', 1, 82.5],
    ['Búlgaras con mancuernas', 'bulgarian_split_squat', 'squat', 0.35, 30],
    ['Hip thrust con barra', 'hip_thrust', 'squat', 1.2, 100],
    ['Front squat', 'front_squat', 'squat', 0.85, 70],
    ['Remo medio arrodillado', 'half_kneeling_row', 'benchPress', 0.35, 30],
  ] as const)('conserva la carga de la variante legítima %s', (name, id, lift, factor, weight) => {
    const definition = findStrengthExerciseByName(name)
    expect(definition?.id).toBe(id)
    expect(definition?.loadReference).toMatchObject({ lift, factor })
    expect(enhance(name)?.weight).toBe(weight)
  })

  it.each([
    ['Press declinado con barra', undefined],
    ['Pendlay row', undefined],
    ['Remo con barra', 'bent_over_row'],
    ['Dominadas pronadas', 'pull_up'],
    // Sin entrada de fondos en el catálogo: el regex viejo lo mandaba a
    // `bench ×0.7`, que era una equivalencia inventada.
    ['Fondos en paralelas', undefined],
    // Ambiguos: el fragmento empata entre dos referencias con factores
    // distintos (`deadlift` 1 vs `romanian_deadlift` 0,8).
    ['Peso muerto rumano con mancuernas', undefined],
    ['Press de banca con mancuerna', undefined],
  ] as const)('no adivina carga para %s', (name, expectedId) => {
    expect(findStrengthExerciseByName(name)?.id).toBe(expectedId)
    expect(enhance(name)?.weight).toBeUndefined()
  })

  it('clasifica el bloque aunque no pueda prescribir carga', () => {
    // La ambigüedad es fail-closed para la carga, no para la clasificación.
    expect(enhance('Peso muerto rumano con mancuernas')?.group).toBe('legs')
    expect(enhance('Dominada lastrada progresiva')?.group).toBe('pull')
  })

  it('rechaza el nombre ambiguo que antes mezclaba definición y factor', () => {
    const name = 'Sentadilla búlgara con mancuernas'
    expect(findStrengthExerciseByName(name)).toBeUndefined()
    expect(enhance(name)?.weight).toBeUndefined()
  })

  it('corrige la carga externa de la sentadilla con peso corporal', () => {
    const definition = findStrengthExerciseByName('Sentadilla con peso corporal')
    expect(definition?.id).toBe('bodyweight_squat')
    expect(definition?.loadReference).toBeUndefined()
    expect(enhance(definition!.name)?.weight).toBeUndefined()
  })
})
