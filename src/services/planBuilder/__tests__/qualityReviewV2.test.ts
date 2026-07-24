import { describe, expect, it } from 'vitest'

import { createRepairMeta } from '../repairWeek'
import { recordRepairAction } from '../repairTaxonomy'
import {
  countRepairsV2,
  countRepairsV2FromRepairMeta,
  reviewPlanQuality,
} from '../qualityReview'
import { buildPlanForTest, buildWeekForTest } from './helpers/qualityTestFixtures'

describe('quality_version = 2', () => {
  it('does not penalise a hydration-only week', () => {
    const baselineWeek = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        repairTaxonomyVersion: 2,
        hydrationActionCount: 0,
        correctiveActionCount: 0,
        structuralActionCount: 0,
        movedSessionCount: 0,
        droppedSessionCount: 0,
        addedFallbackCount: 0,
        filteredSportCount: 0,
        repairedSessionCount: 0,
      },
    })
    const hydratedWeek = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        repairTaxonomyVersion: 2,
        hydrationActionCount: 12,
        correctiveActionCount: 0,
        structuralActionCount: 0,
        movedSessionCount: 0,
        droppedSessionCount: 0,
        addedFallbackCount: 0,
        filteredSportCount: 0,
        repairedSessionCount: 12,
      },
    })

    expect(countRepairsV2(hydratedWeek)).toBe(0)

    const baseline = reviewPlanQuality(buildPlanForTest(), [baselineWeek], { qualityVersion: 2 })
    const hydrated = reviewPlanQuality(buildPlanForTest(), [hydratedWeek], { qualityVersion: 2 })
    expect(hydrated.qualityVersion).toBe(2)
    expect(hydrated.weeks[0].score).toBe(baseline.weeks[0].score)
    expect(hydrated.weeks[0].repairCount).toBe(0)
    expect(hydrated.weeks[0].issues.map((item) => item.code)).not.toContain(
      'quality.generation.high_repair_count',
    )
  })

  it('still preserves the observational hydration counters', () => {
    const week = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        repairTaxonomyVersion: 2,
        hydrationActionCount: 12,
        repairedSessionCount: 12,
      },
    })

    expect(week.generationMeta.hydrationActionCount).toBe(12)
  })

  it('counts a filtered sport once, not twice', () => {
    const week = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        droppedSessionCount: 1,
        filteredSportCount: 1,
        correctiveActionCount: 0,
        structuralActionCount: 0,
        movedSessionCount: 0,
      },
    })

    expect(countRepairsV2(week)).toBe(1)
  })

  it('counts a structural fallback once, not twice', () => {
    const week = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        structuralActionCount: 1,
        addedFallbackCount: 1,
        correctiveActionCount: 0,
        movedSessionCount: 0,
        droppedSessionCount: 0,
      },
    })

    expect(countRepairsV2(week)).toBe(1)
  })

  it('keeps the high-repair warning and penalty disabled in opt-in v2', () => {
    const baselineWeek = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        repairTaxonomyVersion: 2,
        correctiveActionCount: 0,
      },
    })
    const repairedWeek = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        repairTaxonomyVersion: 2,
        correctiveActionCount: 12,
      },
    })

    const baseline = reviewPlanQuality(
      buildPlanForTest(),
      [baselineWeek],
      { qualityVersion: 2 },
    )
    const review = reviewPlanQuality(
      buildPlanForTest(),
      [repairedWeek],
      { qualityVersion: 2 },
    )

    expect(review.weeks[0].repairCount).toBe(12)
    expect(review.weeks[0].score).toBe(baseline.weeks[0].score)
    expect(review.weeks[0].issues.map((item) => item.code)).not.toContain(
      'quality.generation.high_repair_count',
    )
  })

  it('leaves v1 scoring untouched for historical rows', () => {
    const baselineWeek = buildWeekForTest({
      generationMeta: { attempts: 1, repairedSessionCount: 0 },
    })
    const repairedWeek = buildWeekForTest({
      generationMeta: { attempts: 1, repairedSessionCount: 12 },
    })

    const baseline = reviewPlanQuality(buildPlanForTest(), [baselineWeek])
    const review = reviewPlanQuality(buildPlanForTest(), [repairedWeek])
    expect(review.qualityVersion).toBe(1)
    expect(review.weeks[0].repairCount).toBe(12)
    expect(review.weeks[0].score).toBeLessThan(baseline.weeks[0].score)
    expect(review.weeks[0].issues.map((item) => item.code)).toContain(
      'quality.generation.high_repair_count',
    )
  })

  it('preserves the complete legacy v1 repair-count formula', () => {
    const week = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        repairedSessionCount: 2,
        movedSessionCount: 3,
        addedFallbackCount: 4,
        filteredSportCount: 5,
        droppedSessionCount: 9,
      },
    })

    const review = reviewPlanQuality(buildPlanForTest(), [week])

    expect(review.qualityVersion).toBe(1)
    expect(review.weeks[0].repairCount).toBe(14)
    expect(review.repairCount).toBe(14)
  })

  it('only infers v2 when every reviewed week is explicitly marked v2', () => {
    const v2Week = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        qualityVersion: 2,
        repairTaxonomyVersion: 2,
      },
    })
    const legacyWeek = buildWeekForTest({
      weekIndex: 1,
      generationMeta: { attempts: 1 },
    })

    expect(reviewPlanQuality(buildPlanForTest(), [v2Week]).qualityVersion).toBe(2)
    expect(reviewPlanQuality(buildPlanForTest(), [v2Week, legacyWeek]).qualityVersion).toBe(1)
  })

  it('rejects explicit v2 for a week without v2 taxonomy', () => {
    const legacyWeek = buildWeekForTest({
      generationMeta: { attempts: 1, repairedSessionCount: 4 },
    })

    expect(() => reviewPlanQuality(
      buildPlanForTest(),
      [legacyWeek],
      { qualityVersion: 2 },
    )).toThrow('quality_version 2 requires repairTaxonomyVersion 2')
  })

  it('keeps countRepairsV2 in sync with live RepairMeta', () => {
    const meta = createRepairMeta(0)
    meta.movedSessionCount = 2
    meta.droppedSessionCount = 1
    for (let index = 0; index < 3; index++) {
      recordRepairAction(meta.taxonomy, 'corrective', `corrective-${index}`)
    }
    recordRepairAction(meta.taxonomy, 'structural', 'structural-0')
    for (let index = 0; index < 9; index++) {
      recordRepairAction(meta.taxonomy, 'hydration', `hydration-${index}`)
    }

    const week = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        movedSessionCount: 2,
        droppedSessionCount: 1,
        correctiveActionCount: 3,
        structuralActionCount: 1,
        hydrationActionCount: 9,
      },
    })

    expect(countRepairsV2FromRepairMeta(meta)).toBe(countRepairsV2(week))
    expect(countRepairsV2(week)).toBe(7)
  })
})
