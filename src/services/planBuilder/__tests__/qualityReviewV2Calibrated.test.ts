import { describe, expect, it } from 'vitest'

import type { TrainingPlanWeek } from '../../../types/planBuilder'
import { QUALITY_V2_CALIBRATION } from '../qualityCalibrationV2'
import { reviewPlanQuality } from '../qualityReview'
import { buildPlanForTest, buildWeekForTest } from './helpers/qualityTestFixtures'

/** countRepairsV2 = corrective + structural + moved + dropped. */
function weekWithRepairs(
  weekIndex: number,
  corrective: number,
  structural: number,
  moved = 0,
  dropped = 0,
): TrainingPlanWeek {
  return buildWeekForTest({
    weekIndex,
    generationMeta: {
      attempts: 1,
      repairTaxonomyVersion: 2,
      correctiveActionCount: corrective,
      structuralActionCount: structural,
      movedSessionCount: moved,
      droppedSessionCount: dropped,
    },
  })
}

function scoreOf(weeks: TrainingPlanWeek[]) {
  return reviewPlanQuality(buildPlanForTest(), weeks, { qualityVersion: 2 })
}

describe('quality v2 calibrated repair penalty', () => {
  it('applies the frozen weekly divisor', () => {
    const review = scoreOf([weekWithRepairs(0, 2, 1)])
    expect(review.weeks[0].score).toBe(100 - 3)
  })

  it('saturates the weekly penalty at the frozen cap', () => {
    const over = QUALITY_V2_CALIBRATION.weekRepairPenaltyCap + 5
    const review = scoreOf([weekWithRepairs(0, over, 0)])
    expect(review.weeks[0].score).toBe(100 - QUALITY_V2_CALIBRATION.weekRepairPenaltyCap)
  })

  it('applies the frozen plan divisor over the plan total', () => {
    const review = scoreOf([weekWithRepairs(0, 4, 0), weekWithRepairs(1, 4, 0)])
    const average = (review.weeks[0].score + review.weeks[1].score) / 2
    expect(review.score).toBe(Math.round(average) - 2)
  })

  it('saturates the plan penalty at the frozen cap', () => {
    const perWeek = QUALITY_V2_CALIBRATION.planRepairDivisor
      * (QUALITY_V2_CALIBRATION.planRepairPenaltyCap + 3)
    const review = scoreOf([weekWithRepairs(0, perWeek, 0)])
    const average = review.weeks[0].score
    expect(review.score).toBe(average - QUALITY_V2_CALIBRATION.planRepairPenaltyCap)
  })

  it('leaves a hydration-only week at zero penalty', () => {
    const week = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        repairTaxonomyVersion: 2,
        correctiveActionCount: 0,
        structuralActionCount: 0,
        movedSessionCount: 0,
        droppedSessionCount: 0,
        hydrationActionCount: 7,
      },
    })
    expect(reviewPlanQuality(buildPlanForTest(), [week], { qualityVersion: 2 }).weeks[0].score)
      .toBe(100)
  })
})

describe('quality v2 calibrated high repair warning', () => {
  const codeOf = (review: ReturnType<typeof scoreOf>) =>
    review.weeks[0].issues.map((issue) => issue.code)

  it('stays silent one repair below the frozen threshold', () => {
    const below = QUALITY_V2_CALIBRATION.highRepairWarningThreshold - 1
    expect(codeOf(scoreOf([weekWithRepairs(0, below, 0)])))
      .not.toContain('quality.generation.high_repair_count')
  })

  it('fires exactly at the frozen threshold', () => {
    const at = QUALITY_V2_CALIBRATION.highRepairWarningThreshold
    expect(codeOf(scoreOf([weekWithRepairs(0, at, 0)])))
      .toContain('quality.generation.high_repair_count')
  })

  it('reads corrective plus structural, not countRepairsV2', () => {
    const review = scoreOf([weekWithRepairs(0, 1, 1, 2, 2)])
    expect(codeOf(review)).not.toContain('quality.generation.high_repair_count')
  })
})
