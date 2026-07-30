import { describe, expect, it } from 'vitest'
import { resolveBlockPositions } from '../blockIdentity'
import { getPlanPhaseForWeekForTest } from '../qualityReview'

describe('equivalencia review ↔ resolvedor de bloque', () => {
  const cases = [
    {
      name: 'plan con fases',
      phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 2 }],
      weeks: [0, 1, 2].map((weekIndex) => ({ weekIndex, phase: 'build' })),
    },
    {
      name: 'plan sin fases',
      phases: [],
      weeks: [0, 1, 2].map((weekIndex) => ({ weekIndex, phase: 'build' })),
    },
    {
      name: 'semana fuera de rango',
      phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1 }],
      weeks: [
        { weekIndex: 0, phase: 'build' },
        { weekIndex: 4, phase: 'peak' },
      ],
    },
  ]

  for (const testCase of cases) {
    it(`produce el mismo blockId que el review: ${testCase.name}`, () => {
      const positions = resolveBlockPositions(testCase.phases, testCase.weeks)
      for (const week of testCase.weeks) {
        expect(positions.get(week.weekIndex)?.blockId).toBe(
          getPlanPhaseForWeekForTest({ phases: testCase.phases }, week),
        )
      }
    })
  }

  it('da índices ordinales distintos a semanas legacy del mismo grupo', () => {
    const positions = resolveBlockPositions(
      [],
      [0, 1, 2].map((weekIndex) => ({ weekIndex, phase: 'build' })),
    )
    expect([0, 1, 2].map((index) => positions.get(index)?.indexInBlock)).toEqual([0, 1, 2])
  })
})
