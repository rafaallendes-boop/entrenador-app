import { describe, it, expect } from 'vitest'

import { resolveStrengthExercise } from '../exerciseLibrary'
import {
  buildStrengthReplacementById,
  getStrengthReplacementPool,
  type StrengthContext,
} from '../strengthSelector'

const CONTEXT: StrengthContext = {
  fatigueLevel: 2,
  phase: 'peak',
  recentExercises: [],
  goal: 'squash competitivo',
  sportProfile: 'sport_support',
  primarySport: 'squash',
  experienceLevel: 'advanced',
  sessionDurationMin: 60,
  available1RM: ['squat', 'deadlift', 'benchPress', 'overheadPress'],
  weekIndexInBlock: 1,
}

function idOf(name: string): string | undefined {
  return resolveStrengthExercise({ name })?.definition?.id
}

describe('primitivas que consume el allocator — el original no pertenece a su pool', () => {
  it('el pool canónico nunca contiene el mismo id', () => {
    const originalId = idOf('Peso muerto rumano')
    expect(originalId).toBe('romanian_deadlift')

    const pool = getStrengthReplacementPool({ name: 'Peso muerto rumano' }, CONTEXT)
    expect(pool).not.toContain(originalId)
    for (const candidateId of pool) {
      const picked = buildStrengthReplacementById(candidateId, CONTEXT, 1)
      expect(idOf(picked?.name ?? '')).not.toBe(originalId)
    }
  })

  it('trata un alias como el mismo ejercicio: el pool de Remo con barra no contiene Remo inclinado', () => {
    // Ambos nombres resuelven a `bent_over_row` desde §20: uno es alias del otro.
    expect(idOf('Remo con barra')).toBe(idOf('Remo inclinado'))

    const pool = getStrengthReplacementPool({ name: 'Remo con barra' }, CONTEXT)
    expect(pool).not.toContain('bent_over_row')
  })
})
