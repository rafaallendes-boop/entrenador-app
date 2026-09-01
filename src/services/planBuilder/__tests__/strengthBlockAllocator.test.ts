import { describe, it, expect } from 'vitest'
import { allocateStrengthBlock, fnv1a32 } from '../strengthBlockAllocator'

const BLOCK = 'peak:0:11'

function idsOf(result: ReturnType<typeof allocateStrengthBlock>, week: number, slot: string) {
  return result.matrix[week]!.get(slot)
}

describe('fnv1a32', () => {
  it('coincide con el valor golden de FNV-1a 32 bits', () => {
    // Comparar la función consigo misma no prueba nada: pasaría con
    // `Math.random` cacheado. Estos valores son los de la especificación
    // FNV-1a de 32 bits y fijan el algoritmo, no sólo su estabilidad.
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('foobar')).toBe(0xbf9cf968)
  })
})

describe('allocateStrengthBlock', () => {
  it('la columna 0 conserva el original de cada slot', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 3,
      slots: [{ slotKey: 's1', canonicalId: 'a', candidateIds: ['b', 'c'] }],
      fixedIdsByWeek: Array.from({ length: 3 }, () => ({ all: [], countable: [] })),
    })
    expect(idsOf(result, 0, 's1')).toBe('a')
  })

  it('ninguna celda asignada devuelve el id original (I3)', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 3,
      slots: [{ slotKey: 's1', canonicalId: 'a', candidateIds: ['b', 'c'] }],
      fixedIdsByWeek: Array.from({ length: 3 }, () => ({ all: [], countable: [] })),
    })
    for (let week = 1; week < 3; week++) expect(idsOf(result, week, 's1')).not.toBe('a')
  })

  it('respeta la unicidad intra-semana (I2)', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 2,
      slots: [
        { slotKey: 's1', canonicalId: 'x', candidateIds: ['a', 'b'] },
        { slotKey: 's2', canonicalId: 'y', candidateIds: ['a', 'b'] },
      ],
      fixedIdsByWeek: Array.from({ length: 2 }, () => ({ all: [], countable: [] })),
    })
    const week1 = [...result.matrix[1]!.values()]
    expect(new Set(week1).size).toBe(week1.length)
  })

  it('los ids fijos consumen cupo intra-semana', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 2,
      slots: [{ slotKey: 's1', canonicalId: 'x', candidateIds: ['a'] }],
      fixedIdsByWeek: [{ all: [], countable: [] }, { all: ['a'], countable: ['a'] }],
    })
    // La celda degradada conserva su original: el ejercicio sigue en la semana.
    expect(idsOf(result, 1, 's1')).toBe('x')
    expect(result.degradedCells).toContainEqual({ slotKey: 's1', week: 1, reason: 'infeasible_intra_week' })
  })

  it('degrada por celda y no por slot completo', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 3,
      slots: [{ slotKey: 's1', canonicalId: 'x', candidateIds: ['a'] }],
      fixedIdsByWeek: [{ all: [], countable: [] }, { all: [], countable: [] }, { all: ['a'], countable: ['a'] }],
    })
    // La semana 1 sí pudo asignar; sólo la 2 degrada.
    expect(idsOf(result, 1, 's1')).toBe('a')
    expect(result.degradedCells.map((cell) => cell.week)).toEqual([2])
  })

  it('el contraejemplo de Hall degrada en vez de mentir', () => {
    // Necesita TRES columnas: con weekCount 2 sólo existe una semana rotada y
    // "s3 forzado a c dos veces" no puede ocurrir, así que el caso sería vacuo.
    // Con la 0 fija más dos rotadas, s1 y s2 consumen a/b en ambas y s3 queda
    // sin más opción que repetir c.
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 3,
      slots: [
        { slotKey: 's1', canonicalId: 'x', candidateIds: ['a', 'b'] },
        { slotKey: 's2', canonicalId: 'y', candidateIds: ['a', 'b'] },
        { slotKey: 's3', canonicalId: 'z', candidateIds: ['a', 'b', 'c'] },
      ],
      fixedIdsByWeek: [
        { all: [], countable: [] }, { all: [], countable: [] }, { all: [], countable: [] },
      ],
    })
    for (const week of [1, 2]) {
      const ids = [...result.matrix[week]!.values()]
      expect(new Set(ids).size).toBe(ids.length)   // I2 se respeta igual
    }
    expect(result.degradedCells.length).toBeGreaterThan(0)  // y lo admite
  })

  it('I1 es direccional: el main lift actual no cuenta contra sí mismo', () => {
    // `ml` es fijo NO contable en ambas semanas. Si se contara como contable,
    // cada par arrancaría con 1 de solape gratis y el presupuesto se agotaría
    // antes de tiempo.
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 2,
      slots: [
        { slotKey: 's1', canonicalId: 'x', candidateIds: ['a', 'b'] },
        { slotKey: 's2', canonicalId: 'y', candidateIds: ['c', 'd'] },
      ],
      fixedIdsByWeek: [
        { all: ['ml'], countable: [] },
        { all: ['ml'], countable: [] },
      ],
    })
    expect(result.degradedCells).toEqual([])
  })

  it('una celda degradada conserva su original en la matriz y sigue restringiendo', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 2,
      slots: [{ slotKey: 's1', canonicalId: 'x', candidateIds: [] }],
      fixedIdsByWeek: [{ all: [], countable: [] }, { all: [], countable: [] }],
    })
    // No se omite: sigue estando en la semana, así que sigue en la proyección.
    expect(result.matrix[1]!.get('s1')).toBe('x')
  })

  it('un slot sin candidatos degrada con insufficient_pool', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 2,
      slots: [{ slotKey: 's1', canonicalId: 'x', candidateIds: [] }],
      fixedIdsByWeek: Array.from({ length: 2 }, () => ({ all: [], countable: [] })),
    })
    expect(result.degradedCells).toContainEqual({ slotKey: 's1', week: 1, reason: 'insufficient_pool' })
  })

  it('un slot con identidad no resuelta degrada con unresolved_identity', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 2,
      slots: [{ slotKey: 's1', canonicalId: '', candidateIds: ['a'] }],
      fixedIdsByWeek: Array.from({ length: 2 }, () => ({ all: [], countable: [] })),
    })
    expect(result.degradedCells).toContainEqual({ slotKey: 's1', week: 1, reason: 'unresolved_identity' })
  })

  it('corta al alcanzar el óptimo demostrable en vez de quemar el tope', () => {
    // 0 pares en exceso y 0 celdas degradadas es el mínimo de los dos primeros
    // niveles del objetivo: ninguna otra solución puede ganarle. Sin la salida
    // temprana, `searchExhausted` salía `true` incluso acá y quedaba inútil
    // como señal de telemetría.
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 3,
      slots: [
        { slotKey: 's1', canonicalId: 'o1', candidateIds: ['a', 'b', 'c'] },
        { slotKey: 's2', canonicalId: 'o2', candidateIds: ['d', 'e', 'f'] },
      ],
      fixedIdsByWeek: Array.from({ length: 3 }, () => ({ all: ['ml'], countable: [] })),
    })
    expect(result.degradedCells).toEqual([])
    expect(result.searchExhausted).toBe(false)
  })

  it('dos originales sin resolver no se cuentan como el mismo id', () => {
    // Con un centinela único colapsado, ambos slots valdrían el mismo id: se
    // ocuparían cupo en I2 y contarían UNO solo en I1, cuando `qualityReview`
    // los trata como ids distintos por nombre normalizado.
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 2,
      slots: [
        { slotKey: 's1', canonicalId: 'unresolved:Remo raro', candidateIds: ['a'] },
        { slotKey: 's2', canonicalId: 'unresolved:Otro raro', candidateIds: ['b'] },
      ],
      fixedIdsByWeek: Array.from({ length: 2 }, () => ({ all: [], countable: [] })),
    })
    expect(idsOf(result, 1, 's1')).toBe('unresolved:Remo raro')
    expect(idsOf(result, 1, 's2')).toBe('unresolved:Otro raro')
    const week1 = [...result.matrix[1]!.values()]
    expect(new Set(week1).size).toBe(2)
    expect(result.degradedCells).toEqual([
      { slotKey: 's1', week: 1, reason: 'unresolved_identity' },
      { slotKey: 's2', week: 1, reason: 'unresolved_identity' },
    ])
  })

  it('ante empate degrada la semana más tardía, no la más temprana', () => {
    // Escenario con exactamente dos soluciones mínimas, ambas con 0 pares en
    // exceso y 1 celda degradada, que difieren en QUÉ celda degradan:
    //   - s1=a en la semana 1 bloquea a s2 (su único candidato) -> degrada en 1
    //   - s1=b en la semana 1 deja pasar a s2=a, y el choque cae en la 2
    // El fijo `f1` compartido consume 1 de presupuesto en todo par, que es lo
    // que deja exactamente una repetición de margen y fuerza el empate.
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 3,
      slots: [
        { slotKey: 's1', canonicalId: 'x', candidateIds: ['a', 'b'] },
        { slotKey: 's2', canonicalId: 'y', candidateIds: ['a'] },
      ],
      fixedIdsByWeek: Array.from({ length: 3 }, () => ({ all: ['f1'], countable: ['f1'] })),
    })
    expect(result.degradedCells).toEqual([
      { slotKey: 's2', week: 2, reason: 'infeasible_intra_week' },
    ])
  })

  it('prefiere dos degradaciones sin pares I1 en exceso sobre dos con exceso', () => {
    // Cada core fijo y contable deja sólo un id compartido de margen por par.
    // La primera solución de candidatos fuerza dos originales en la semana 2
    // y deja un par con tres ids compartidos. Degradar s3 ya en la semana 1
    // libera su candidato para la 2: conserva DOS degradaciones, pero elimina
    // por completo los pares I1 en exceso. La degradación debe explorarse aun
    // cuando la celda tenga candidatos admisibles.
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 3,
      slots: [
        { slotKey: 's0', canonicalId: 'o0', candidateIds: ['f', 'e'] },
        { slotKey: 's1', canonicalId: 'o1', candidateIds: ['a', 'c'] },
        { slotKey: 's2', canonicalId: 'o2', candidateIds: ['a', 'c'] },
        { slotKey: 's3', canonicalId: 'o3', candidateIds: ['e', 'f', 'b'] },
      ],
      fixedIdsByWeek: Array.from({ length: 3 }, () => ({ all: ['core'], countable: ['core'] })),
    })

    expect(result.degradedCells).toHaveLength(2)
    let excessPairs = 0
    for (let earlier = 0; earlier < 3; earlier++) {
      for (let later = earlier + 1; later < 3; later++) {
        const allEarlier = new Set(['core', ...result.matrix[earlier]!.values()])
        const countableLater = new Set(['core', ...result.matrix[later]!.values()])
        const overlap = [...countableLater].filter((id) => allEarlier.has(id)).length
        if (overlap > 2) excessPairs += 1
      }
    }
    expect(excessPairs).toBe(0)
  })

  it('reparte alternativas entre sesiones homólogas en lugar de clonar una', () => {
    // Dos sesiones comparten sólo cuatro alternativas reales. Si I1 se mide
    // sobre la unión semanal, la búsqueda llena primero una sesión y deja la
    // otra con los cuatro originales. Por ordinal ambas pueden conservar dos
    // coincidencias (el presupuesto) sin producir una plantilla repetida.
    const slots = ['0', '1', '2', '3'].flatMap((index) => [
      {
        slotKey: `a${index}`,
        canonicalId: `a${index}`,
        candidateIds: ['x0', 'x1', 'x2', 'x3'],
        overlapGroup: 'session:0',
      },
      {
        slotKey: `b${index}`,
        canonicalId: `b${index}`,
        candidateIds: ['x0', 'x1', 'x2', 'x3'],
        overlapGroup: 'session:1',
      },
    ])
    const result = allocateStrengthBlock({
      blockId: BLOCK,
      weekCount: 2,
      slots,
      fixedIdsByWeek: Array.from({ length: 2 }, () => ({
        all: [],
        countable: [],
        groups: [
          { groupKey: 'session:0', all: [], countable: [] },
          { groupKey: 'session:1', all: [], countable: [] },
        ],
      })),
    })

    for (const groupPrefix of ['a', 'b']) {
      const slotKeys = slots
        .filter((slot) => slot.slotKey.startsWith(groupPrefix))
        .map((slot) => slot.slotKey)
      const earlier = new Set(slotKeys.map((slotKey) => result.matrix[0]!.get(slotKey)!))
      const later = new Set(slotKeys.map((slotKey) => result.matrix[1]!.get(slotKey)!))
      expect([...later].filter((id) => earlier.has(id))).toHaveLength(2)
    }

    // I2 sigue siendo semanal: las cuatro alternativas no aparecen dos veces
    // en la misma columna, aunque I1 se haya separado por sesión.
    const weekOne = [...result.matrix[1]!.values()]
    expect(weekOne.filter((id) => id.startsWith('x'))).toHaveLength(4)
    expect(new Set(weekOne.filter((id) => id.startsWith('x'))).size).toBe(4)
  })

  it('es determinista: el mismo input da la misma matriz', () => {
    const input = {
      blockId: BLOCK, weekCount: 4,
      slots: [
        { slotKey: 's1', canonicalId: 'x', candidateIds: ['a', 'b', 'c'] },
        { slotKey: 's2', canonicalId: 'y', candidateIds: ['b', 'c', 'd'] },
      ],
      fixedIdsByWeek: Array.from({ length: 4 }, () => ({ all: [], countable: [] })),
    }
    const first = allocateStrengthBlock(input)
    const second = allocateStrengthBlock(input)
    for (let week = 0; week < 4; week++) {
      expect([...second.matrix[week]!.entries()].sort()).toEqual([...first.matrix[week]!.entries()].sort())
    }
  })

  it('bajo el tope de nodos devuelve la mejor visitada sin lanzar', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 12,
      slots: Array.from({ length: 6 }, (_, index) => ({
        slotKey: `s${index}`, canonicalId: `orig${index}`,
        candidateIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      })),
      fixedIdsByWeek: Array.from({ length: 12 }, () => ({ all: [], countable: [] })),
      maxNodes: 50,
    })
    expect(result.matrix).toHaveLength(12)
    expect(result.searchExhausted).toBe(true)
  })

  it('no etiqueta como search_exhausted una degradación que ya era infactible', () => {
    // s2 no puede tomar `a` después de s1 en la misma semana. El tope cae al
    // empezar la semana 2, de modo que conviven una causa real y celdas que
    // sí quedaron sin explorar: la telemetría debe distinguirlas.
    const result = allocateStrengthBlock({
      blockId: BLOCK,
      weekCount: 3,
      slots: [
        { slotKey: 's1', canonicalId: 'x', candidateIds: ['a'] },
        { slotKey: 's2', canonicalId: 'y', candidateIds: ['a'] },
      ],
      fixedIdsByWeek: Array.from({ length: 3 }, () => ({ all: [], countable: [] })),
      maxNodes: 2,
    })

    expect(result.searchExhausted).toBe(true)
    expect(result.degradedCells).toContainEqual({
      slotKey: 's2', week: 1, reason: 'infeasible_intra_week',
    })
    expect(result.degradedCells.some((cell) => cell.reason === 'search_exhausted')).toBe(true)
  })
})
