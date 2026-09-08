import { describe, expect, it } from 'vitest'

import {
  analysePaceRoles,
  canonicalize,
  compareDuration,
  detectTextualRecoveries,
  sha256Of,
  summarizeCoverage,
  summarizeDose,
} from './probe-selectors/normalize.mjs'

/**
 * La parte del probe que decide *qué* se compara entre dos corridas necesita
 * sus propias pruebas: si la normalización fuera inestable, el artefacto
 * congelado dejaría de acreditar nada y una entrega podría cambiar el
 * comportamiento sin que se notara.
 */

describe('canonicalize / sha256Of', () => {
  it('produce el mismo hash con claves en distinto orden', () => {
    const a = { b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }
    const b = { a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }
    expect(sha256Of(a)).toBe(sha256Of(b))
  })

  it('distingue hashes cuando cambia un valor', () => {
    expect(sha256Of({ a: 1 })).not.toBe(sha256Of({ a: 2 }))
  })

  it('omite undefined pero conserva null', () => {
    expect(canonicalize({ a: undefined, b: null })).toEqual({ b: null })
  })

  it('preserva el orden de los arreglos', () => {
    expect(sha256Of([1, 2])).not.toBe(sha256Of([2, 1]))
  })
})

describe('summarizeDose', () => {
  it('suma duraciones conocidas', () => {
    expect(summarizeDose([{ durationMin: 10 }, { durationMin: 5 }])).toEqual({
      knownMin: 15,
      unknownBlocks: 0,
      itemCount: 2,
    })
  })

  it('multiplica por repeticiones', () => {
    expect(summarizeDose([{ durationMin: 4, repetitions: 5 }]).knownMin).toBe(20)
  })

  it('cuenta como desconocido un bloque por distancia sin duración', () => {
    // El caso real: `repetitions: 5, distanceKm: 0.8` sin ritmo. Sumarlo como
    // cero haría que un total incompleto pareciera cerrado.
    const dose = summarizeDose([{ durationMin: 10 }, { repetitions: 5, distanceKm: 0.8 }])
    expect(dose).toEqual({ knownMin: 10, unknownBlocks: 1, itemCount: 2 })
  })

  it('tolera lista ausente', () => {
    expect(summarizeDose(undefined)).toEqual({ knownMin: 0, unknownBlocks: 0, itemCount: 0 })
  })
})

describe('compareDuration', () => {
  it('marca exact, over y under', () => {
    const dose = (knownMin) => ({ knownMin, unknownBlocks: 0, itemCount: 1 })
    expect(compareDuration(30, dose(30)).verdict).toBe('exact')
    expect(compareDuration(30, dose(35)).verdict).toBe('over')
    expect(compareDuration(30, dose(25)).verdict).toBe('under')
  })

  it('no inventa un delta cuando hay bloques sin duración', () => {
    const result = compareDuration(60, { knownMin: 20, unknownBlocks: 1, itemCount: 3 })
    expect(result.verdict).toBe('unknown')
    expect(result.deltaMin).toBeNull()
  })
})

describe('analysePaceRoles', () => {
  it('detecta que el calentamiento comparte ritmo con el bloque de trabajo', () => {
    const analysis = analysePaceRoles([
      { label: 'Calentamiento Z2', targetPace: '4:40-5:00 /km' },
      { label: 'Tempo umbral controlado', targetPace: '4:40-5:00 /km' },
      { label: 'Enfriamiento Z2', targetPace: '4:40-5:00 /km' },
    ])
    expect(analysis.sharedPaceWithWork).toBe(true)
    expect(analysis.distinctPaces).toBe(1)
  })

  it('no marca ritmo compartido cuando entrada y trabajo difieren', () => {
    const analysis = analysePaceRoles([
      { label: 'Calentamiento Z2', targetPace: '5:40 /km' },
      { label: 'Tempo umbral controlado', targetPace: '4:40 /km' },
    ])
    expect(analysis.sharedPaceWithWork).toBe(false)
  })

  it('ignora bloques sin ritmo en vez de contarlos como compartidos', () => {
    const analysis = analysePaceRoles([
      { label: 'Calentamiento caminata', targetPace: null },
      { label: 'Trote Z2 continuo', targetPace: null },
    ])
    expect(analysis.sharedPaceWithWork).toBe(false)
  })
})

describe('detectTextualRecoveries', () => {
  it('encuentra recuperaciones descritas en texto libre', () => {
    const labels = detectTextualRecoveries([
      { label: 'Series principales', notes: 'Recupera 2-3 min trotando entre repeticiones.' },
      { label: 'Enfriamiento Z2', notes: 'Baja pulsaciones sin apurar.' },
    ])
    expect(labels).toEqual(['Series principales'])
  })
})

describe('summarizeCoverage', () => {
  it('agrega casos por hallazgo y sección', () => {
    const coverage = summarizeCoverage({
      squashHydration: [{ covers: ['S1'] }, { covers: ['S1', 'S5'] }],
      chat: [{ covers: ['S1'] }],
    })
    expect(coverage).toEqual([
      { finding: 'S1', sections: ['chat', 'squashHydration'], caseCount: 3 },
      { finding: 'S5', sections: ['squashHydration'], caseCount: 1 },
    ])
  })
})
