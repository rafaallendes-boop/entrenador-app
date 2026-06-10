import { describe, expect, it } from 'vitest'
import type { TrainingPlan } from '../../../types/planBuilder'
import { shouldDeleteEmptyShellDraft, shouldLoadMatchingDraftPlan } from '../draftAutoload'

function makePlan(generationState: TrainingPlan['generationState'] = 'shell'): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState,
    title: 'Plan',
    startDate: '2026-06-01',
    endDate: '2026-06-14',
    totalWeeks: 2,
    phases: [],
    wizardConfig: {} as never,
    macroSnapshot: {} as never,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('draftAutoload', () => {
  it('loads a generating draft even when weeks have not synced yet', () => {
    const plan = makePlan('generating')

    expect(shouldLoadMatchingDraftPlan(plan, 0)).toBe(true)
    expect(shouldDeleteEmptyShellDraft(plan, 0)).toBe(false)
  })

  it('deletes only empty shell drafts', () => {
    const plan = makePlan('shell')

    expect(shouldLoadMatchingDraftPlan(plan, 0)).toBe(false)
    expect(shouldDeleteEmptyShellDraft(plan, 0)).toBe(true)
  })

  it('loads any matching draft that already has weeks', () => {
    const plan = makePlan('shell')

    expect(shouldLoadMatchingDraftPlan(plan, 1)).toBe(true)
    expect(shouldDeleteEmptyShellDraft(plan, 1)).toBe(false)
  })
})
