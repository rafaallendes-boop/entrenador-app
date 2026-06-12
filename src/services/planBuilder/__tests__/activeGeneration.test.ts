import { describe, expect, it } from 'vitest'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { ACTIVE_GENERATION_TTL_MS, buildRetriggerPlan, isActivePlanGeneration } from '../activeGeneration'

const NOW = 1_750_000_000_000

function makePlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'a1',
    goalEventId: 'e1',
    status: 'draft',
    generationState: 'generating',
    title: 'Plan Test',
    startDate: '2026-06-08',
    endDate: '2026-07-26',
    totalWeeks: 7,
    phases: [],
    wizardConfig: {} as TrainingPlan['wizardConfig'],
    macroSnapshot: {} as TrainingPlan['macroSnapshot'],
    createdAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    generationSummary: {
      startedAt: NOW - 60_000,
      jobId: 'plan-bg-old',
      strategy: 'single',
      completedWeeks: 0,
      failedWeeks: [],
      totalAttempts: 0,
      heartbeatAt: NOW - 30_000,
    },
    ...overrides,
  } as TrainingPlan
}

function makeWeek(weekIndex: number, status: TrainingPlanWeek['status'], sessions = 0): TrainingPlanWeek {
  return {
    id: `w${weekIndex}`,
    planId: 'plan-1',
    weekIndex,
    weekStartDate: '2026-06-08',
    phase: 'build',
    status,
    sessions: Array.from({ length: sessions }, (_, i) => ({ date: '2026-06-08', timeBlock: 'AM', sessionType: 'squash', title: `s${i}`, durationMin: 60, objective: 'x' })),
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as TrainingPlanWeek
}

describe('isActivePlanGeneration', () => {
  it('treats a generating plan with jobId and fresh heartbeat as active', () => {
    expect(isActivePlanGeneration(makePlan(), NOW)).toBe(true)
  })

  it('is not active without jobId (client pre-trigger state)', () => {
    const plan = makePlan()
    plan.generationSummary = { ...plan.generationSummary!, jobId: undefined }
    expect(isActivePlanGeneration(plan, NOW)).toBe(false)
  })

  it('is not active when the previous run already completed (stale client re-push)', () => {
    const plan = makePlan()
    plan.generationSummary = { ...plan.generationSummary!, completedAt: NOW - 120_000 }
    expect(isActivePlanGeneration(plan, NOW)).toBe(false)
  })

  it('is not active when the heartbeat is older than the TTL', () => {
    const plan = makePlan()
    plan.generationSummary = { ...plan.generationSummary!, heartbeatAt: NOW - ACTIVE_GENERATION_TTL_MS - 1 }
    expect(isActivePlanGeneration(plan, NOW)).toBe(false)
  })

  it('is not active when cancel was requested or state is terminal', () => {
    const cancelled = makePlan()
    cancelled.generationSummary = { ...cancelled.generationSummary!, cancelRequested: true }
    expect(isActivePlanGeneration(cancelled, NOW)).toBe(false)
    expect(isActivePlanGeneration(makePlan({ generationState: 'partial' }), NOW)).toBe(false)
    expect(isActivePlanGeneration(null, NOW)).toBe(false)
  })
})

describe('buildRetriggerPlan', () => {
  it('strips jobId, completedAt and cancelRequested so the background function does not dedupe the retry', () => {
    const plan = makePlan({ generationState: 'partial' })
    plan.generationSummary = {
      ...plan.generationSummary!,
      completedAt: NOW - 120_000,
      totalDurationMs: 548_000,
      cancelRequested: true,
      failedWeeks: [1],
    }
    const weeks = [makeWeek(0, 'draft', 3), makeWeek(1, 'pending')]
    const next = buildRetriggerPlan(plan, weeks, NOW)

    expect(next.generationState).toBe('generating')
    expect(next.updatedAt).toBe(NOW)
    expect(next.generationSummary?.jobId).toBeUndefined()
    expect(next.generationSummary?.completedAt).toBeUndefined()
    expect(next.generationSummary?.cancelRequested).toBeUndefined()
    expect(next.generationSummary?.heartbeatAt).toBe(NOW)
    expect(next.generationSummary?.startedAt).toBe(NOW)
    expect(next.generationSummary?.completedWeeks).toBe(1)
    expect(next.generationSummary?.failedWeeks).toEqual([])
  })

  it('passes the active-generation guard only until a real worker takes over', () => {
    const plan = makePlan({ generationState: 'complete' })
    plan.generationSummary = { ...plan.generationSummary!, completedAt: NOW - 120_000 }
    const retrigger = buildRetriggerPlan(plan, [makeWeek(0, 'pending')], NOW)
    // El estado pre-trigger del cliente nunca debe contar como generación activa.
    expect(isActivePlanGeneration(retrigger, NOW + 1_000)).toBe(false)
  })
})
