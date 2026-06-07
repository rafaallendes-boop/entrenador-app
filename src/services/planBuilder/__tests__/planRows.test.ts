import { describe, expect, it } from 'vitest'
import type { PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import {
  rowToTrainingPlan,
  rowToTrainingPlanWeek,
  trainingPlanToRow,
  trainingPlanWeekToRow,
} from '../planRows'

function makePlan(): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'generating',
    title: 'Plan test',
    startDate: '2026-06-01',
    endDate: '2026-06-14',
    totalWeeks: 2,
    phases: [],
    wizardConfig: {} as PlanWizardConfig,
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-06-14',
      currentPhase: 'build',
      weeksRemaining: 2,
      blockFocus: '',
      headline: '',
      timeline: [],
      sportDetails: [],
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 1,
    updatedAt: 2,
    generationSummary: {
      startedAt: 1,
      jobId: 'job-1',
      strategy: 'single',
      completedWeeks: 0,
      failedWeeks: [],
      totalAttempts: 0,
      heartbeatAt: 2,
    },
  }
}

function makeWeek(): TrainingPlanWeek {
  return {
    id: 'week-1',
    planId: 'plan-1',
    weekIndex: 0,
    weekStartDate: '2026-06-01',
    phase: 'build',
    status: 'generating',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 1 },
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('planRows', () => {
  it('round-trips generationState and generationSummary', () => {
    const plan = makePlan()
    const row = trainingPlanToRow(plan, 'user-1')
    const restored = rowToTrainingPlan(row)

    expect(row.generation_state).toBe('generating')
    expect(restored.generationState).toBe('generating')
    expect(restored.generationSummary?.jobId).toBe('job-1')
    expect(restored.generationSummary?.heartbeatAt).toBe(2)
  })

  it('does not hardcode legacy draft rows as complete', () => {
    const row = trainingPlanToRow(makePlan(), 'user-1')
    delete row.generation_state

    expect(rowToTrainingPlan(row).generationState).toBe('shell')
  })

  it('round-trips generated week rows', () => {
    const week = makeWeek()
    const row = trainingPlanWeekToRow(week, 'user-1')
    const restored = rowToTrainingPlanWeek(row)

    expect(row.status).toBe('generating')
    expect(restored.planId).toBe('plan-1')
    expect(restored.generationMeta.attempts).toBe(1)
  })
})
