import { describe, expect, it } from 'vitest'

import { PRODUCTIVE_QUALITY_VERSION, reviewPlanQuality } from '../qualityReview'
import { buildPlanForTest, buildWeekForTest } from './helpers/qualityTestFixtures'

describe('PRODUCTIVE_QUALITY_VERSION contract', () => {
  it('matches the version the gate resolves for an unmarked productive run', () => {
    // Semana sin marca (sin generationMeta.qualityVersion): el gate la resuelve por
    // su propia lógica. Debe coincidir con la versión que la variante etiqueta.
    const week = buildWeekForTest({ generationMeta: { attempts: 1 } })
    const review = reviewPlanQuality(buildPlanForTest(), [week])
    expect(review.qualityVersion).toBe(PRODUCTIVE_QUALITY_VERSION)
  })
})
