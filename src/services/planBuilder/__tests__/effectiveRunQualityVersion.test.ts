import { describe, expect, it } from 'vitest'

import type { TrainingPlanWeek } from '../../../types/planBuilder'
import {
  resolveEffectiveRunQualityVersion,
  reviewPlanQuality,
} from '../qualityReview'
import { buildPlanForTest } from './helpers/qualityTestFixtures'

function week(weekIndex: number, kind: 'legacy' | 'v2' | 'pending'): TrainingPlanWeek {
  const base = {
    id: `w${weekIndex}`,
    planId: 'p',
    weekIndex,
    weekStartDate: '2026-08-03',
    phase: 'build' as const,
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    createdAt: 1,
    updatedAt: 1,
  }
  if (kind === 'pending') {
    return {
      ...base,
      status: 'pending',
      sessions: [],
      generationMeta: { attempts: 0 },
    } as TrainingPlanWeek
  }
  return {
    ...base,
    status: 'draft',
    sessions: [{}] as TrainingPlanWeek['sessions'],
    generationMeta: kind === 'v2'
      ? { attempts: 1, repairTaxonomyVersion: 2, qualityVersion: 2 }
      : { attempts: 1 },
  } as TrainingPlanWeek
}

describe('resolveEffectiveRunQualityVersion', () => {
  it('stays v1 while the productive constant is 1', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'pending'), week(1, 'pending')],
      productiveVersion: 1,
    })).toBe(1)
  })

  it('is v2 for a brand new plan where every week is a target', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'pending'), week(1, 'pending')],
      productiveVersion: 2,
    })).toBe(2)
  })

  it('is v2 for an explicit full regeneration of a legacy plan', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'legacy'), week(1, 'legacy')],
      targetWeekIndexes: [0, 1],
      productiveVersion: 2,
    })).toBe(2)
  })

  it('falls back to v1 when a legacy week stays outside the targets', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'legacy'), week(1, 'pending')],
      targetWeekIndexes: [1],
      productiveVersion: 2,
    })).toBe(1)
  })

  it('is v2 when every non-target week is already v2', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'v2'), week(1, 'pending')],
      targetWeekIndexes: [1],
      productiveVersion: 2,
    })).toBe(2)
  })

  it('keeps a ready legacy week outside implicit targets', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'legacy'), week(1, 'pending')],
      productiveVersion: 2,
    })).toBe(1)
  })

  it('treats a minimally validated malformed week as legacy instead of throwing', () => {
    const malformed = {
      ...week(0, 'legacy'),
      status: 'draft',
      sessions: undefined,
      generationMeta: undefined,
    } as unknown as TrainingPlanWeek

    expect(resolveEffectiveRunQualityVersion({
      weeks: [malformed],
      productiveVersion: 2,
    })).toBe(1)
  })

  it('treats malformed optional targets as legacy instead of throwing before telemetry', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'pending')],
      targetWeekIndexes: { length: 1 } as unknown as number[],
      productiveVersion: 2,
    })).toBe(1)
  })

  it('keeps a pending shell outside explicit targets on v1', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'pending'), week(1, 'pending')],
      targetWeekIndexes: [1],
      productiveVersion: 2,
    })).toBe(1)
  })
})

describe('quality version precondition during a run', () => {
  const plan = buildPlanForTest({ id: 'p' })

  it('ignores pending shells when v2 is requested mid-run', () => {
    expect(() => reviewPlanQuality(plan, [week(0, 'v2'), week(1, 'pending')], {
      qualityVersion: 2,
    })).not.toThrow()
  })

  it('ignores target weeks this run has not replaced yet', () => {
    expect(() => reviewPlanQuality(plan, [week(0, 'legacy'), week(1, 'legacy')], {
      qualityVersion: 2,
      pendingTargetWeekIndexes: [0, 1],
    })).not.toThrow()
  })

  it('still throws when a non-target week lacks v2 taxonomy', () => {
    expect(() => reviewPlanQuality(plan, [week(0, 'legacy'), week(1, 'v2')], {
      qualityVersion: 2,
      pendingTargetWeekIndexes: [1],
    })).toThrow(/repairTaxonomyVersion/)
  })
})
