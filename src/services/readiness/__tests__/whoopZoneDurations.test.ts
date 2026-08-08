import { describe, it, expect } from 'vitest'
import { normalizeWorkoutScoreData } from '../whoopZoneDurations'

function zones(values: Partial<Record<'z0' | 'z1' | 'z2' | 'z3' | 'z4' | 'z5', unknown>> = {}) {
  return { z0: 1000, z1: 2000, z2: 3000, z3: 4000, z4: 5000, z5: 6000, ...values }
}

describe('normalizeWorkoutScoreData', () => {
  it('acepta una distribución completa con score SCORED', () => {
    expect(normalizeWorkoutScoreData({
      scoreState: 'SCORED',
      zones: zones(),
      percentRecorded: 98.5,
    })).toEqual({
      zoneDurations: { z0: 1000, z1: 2000, z2: 3000, z3: 4000, z4: 5000, z5: 6000 },
      percentRecorded: 98.5,
    })
  })

  it('descarta AMBOS campos si el estado no es SCORED', () => {
    for (const scoreState of ['PENDING_SCORE', 'UNSCORABLE', 'algo', undefined, null]) {
      expect(normalizeWorkoutScoreData({
        scoreState,
        zones: zones(),
        percentRecorded: 98.5,
      })).toEqual({})
    }
  })

  it('descarta la distribución completa si falta cualquier clave', () => {
    const result = normalizeWorkoutScoreData({
      scoreState: 'SCORED',
      zones: zones({ z3: undefined }),
      percentRecorded: 98.5,
    })
    expect(result.zoneDurations).toBeUndefined()
    expect(result.percentRecorded).toBe(98.5)
  })

  it('descarta la distribución si alguna zona no es un entero seguro', () => {
    for (const bad of [1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 2, '1000', null]) {
      expect(normalizeWorkoutScoreData({
        scoreState: 'SCORED',
        zones: zones({ z2: bad }),
        percentRecorded: 50,
      }).zoneDurations).toBeUndefined()
    }
  })

  it('descarta la distribución si alguna zona es negativa', () => {
    expect(normalizeWorkoutScoreData({
      scoreState: 'SCORED',
      zones: zones({ z4: -1 }),
      percentRecorded: 50,
    }).zoneDurations).toBeUndefined()
  })

  it('descarta una distribución de seis ceros: no describe nada', () => {
    expect(normalizeWorkoutScoreData({
      scoreState: 'SCORED',
      zones: { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
      percentRecorded: 50,
    }).zoneDurations).toBeUndefined()
  })

  it('acepta ceros mientras la suma sea positiva', () => {
    expect(normalizeWorkoutScoreData({
      scoreState: 'SCORED',
      zones: { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 1 },
      percentRecorded: 50,
    }).zoneDurations).toEqual({ z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 1 })
  })

  it('valida percentRecorded por separado: finito y entre 0 y 100', () => {
    for (const bad of [-0.1, 100.1, Number.NaN, Infinity, '50', null, undefined]) {
      const result = normalizeWorkoutScoreData({
        scoreState: 'SCORED',
        zones: zones(),
        percentRecorded: bad,
      })
      expect(result.percentRecorded).toBeUndefined()
      expect(result.zoneDurations).toBeDefined()
    }
    for (const ok of [0, 100, 89.96]) {
      expect(normalizeWorkoutScoreData({
        scoreState: 'SCORED',
        zones: zones(),
        percentRecorded: ok,
      }).percentRecorded).toBe(ok)
    }
  })

  it('descartar la distribución no descarta la cobertura', () => {
    expect(normalizeWorkoutScoreData({
      scoreState: 'SCORED',
      zones: zones({ z0: -1 }),
      percentRecorded: 72.4,
    })).toEqual({ percentRecorded: 72.4 })
  })
})
