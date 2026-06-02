import { describe, expect, it } from 'vitest'
import type { PlanGenerationSummary, PlanWeekStatus, TrainingPlanWeek } from '../../../types/planBuilder'
import type { PlanQualityReview } from '../qualityReview'

describe('Phase 3 plan builder type extensions', () => {
  it('PlanWeekStatus includes regenerating', () => {
    const status: PlanWeekStatus = 'regenerating'
    expect(status).toBe('regenerating')
  })

  it('PlanGenerationSummary accepts qualityReview', () => {
    const review = {
      score: 80,
      grade: 'good',
      issues: [],
      weeks: [],
      repairCount: 0,
      criticalIssueCount: 0,
      warningCount: 0,
    } satisfies PlanQualityReview

    const summary: PlanGenerationSummary = {
      startedAt: 1,
      strategy: 'single',
      completedWeeks: 9,
      failedWeeks: [],
      totalAttempts: 9,
      qualityReview: review,
    }

    expect(summary.qualityReview?.grade).toBe('good')
  })

  it('TrainingPlanWeek accepts regenerationMeta with attempt history', () => {
    const week = {
      id: 'w',
      planId: 'p',
      weekIndex: 0,
      weekStartDate: '2026-06-01',
      phase: 'build',
      status: 'accepted',
      sessions: [],
      weekObjectives: [],
      targetLoadBySport: {},
      validationIssues: [],
      generationMeta: { attempts: 1 },
      regenerationMeta: {
        attempts: 1,
        lastRegeneratedAt: 2,
        previousFallbackUsed: true,
      },
      createdAt: 1,
      updatedAt: 1,
    } satisfies TrainingPlanWeek

    expect(week.regenerationMeta?.attempts).toBe(1)
  })
})
