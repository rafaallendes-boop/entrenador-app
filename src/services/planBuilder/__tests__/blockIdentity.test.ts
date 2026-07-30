import { describe, expect, it } from 'vitest'
import { resolveBlockPositions } from '../blockIdentity'

describe('resolveBlockPositions', () => {
  it('usa el rango declarado cuando la semana cae dentro de una fase', () => {
    const positions = resolveBlockPositions(
      [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 3 }],
      [0, 1, 2, 3].map((weekIndex) => ({ weekIndex, phase: 'build' })),
    )

    expect(positions.get(0)).toEqual({ blockId: 'build:0:3', indexInBlock: 0 })
    expect(positions.get(2)).toEqual({ blockId: 'build:0:3', indexInBlock: 2 })
  })

  it('da índices ordinales crecientes en planes legacy sin fases', () => {
    const positions = resolveBlockPositions(
      [],
      [
        { weekIndex: 5, phase: 'build' },
        { weekIndex: 2, phase: 'build' },
        { weekIndex: 9, phase: 'taper' },
      ],
    )

    // Ordinal por orden de weekIndex dentro del grupo, no por posición en el array.
    expect(positions.get(2)).toEqual({ blockId: 'build:legacy', indexInBlock: 0 })
    expect(positions.get(5)).toEqual({ blockId: 'build:legacy', indexInBlock: 1 })
    expect(positions.get(9)).toEqual({ blockId: 'taper:legacy', indexInBlock: 0 })
  })

  it('agrupa fases legacy no contiguas con el mismo nombre', () => {
    const positions = resolveBlockPositions(
      [],
      [
        { weekIndex: 0, phase: 'build' },
        { weekIndex: 1, phase: 'taper' },
        { weekIndex: 2, phase: 'build' },
      ],
    )

    expect(positions.get(0)?.blockId).toBe('build:legacy')
    expect(positions.get(2)?.blockId).toBe('build:legacy')
    expect(positions.get(2)?.indexInBlock).toBe(1)
  })

  it('da grupo unitario e índice 0 a semanas fuera de los rangos declarados', () => {
    const positions = resolveBlockPositions(
      [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1 }],
      [
        { weekIndex: 0, phase: 'build' },
        { weekIndex: 7, phase: 'peak' },
      ],
    )

    expect(positions.get(7)).toEqual({ blockId: 'peak:7:7', indexInBlock: 0 })
  })
})
