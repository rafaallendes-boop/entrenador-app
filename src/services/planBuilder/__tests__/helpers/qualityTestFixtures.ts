import type { PlanWizardConfig } from '../../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../../types/planBuilder'
import { buildSkeletonSessionForTest } from './repairTestFixtures'

const DAY_MS = 24 * 60 * 60 * 1000

function weekStartFor(weekIndex: number): string {
  return new Date(Date.UTC(2026, 7, 3) + weekIndex * 7 * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

export function buildPlanForTest(
  overrides: Partial<TrainingPlan> = {},
): TrainingPlan {
  const wizardConfig: PlanWizardConfig = {
    goalEventId: 'event-1',
    trainingDays: ['monday'],
    sessionsPerWeek: 1,
    sessionDurationMins: 45,
    allowDoubleSession: false,
    doubleSessionDays: [],
    complementarySports: [],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    createdAt: '',
    updatedAt: '',
  }
  const base: TrainingPlan = {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'complete',
    title: 'Quality fixture',
    startDate: '2026-08-03',
    endDate: '2026-08-16',
    totalWeeks: 2,
    phases: [{
      phase: 'base',
      startWeekIndex: 0,
      endWeekIndex: 1,
      blockFocus: 'fixture',
      intentBySport: {},
    }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-08-16',
      currentPhase: 'base',
      weeksRemaining: 2,
      blockFocus: 'fixture',
      headline: '',
      timeline: [],
      sportDetails: [{
        sport: 'running',
        role: 'primary',
        phaseFocus: '',
        weeklyIntent: '',
        volumeBias: 'hold',
        intensityBias: 'hold',
        notes: '',
      }],
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 0,
    updatedAt: 0,
  }

  return { ...base, ...overrides }
}

export function buildWeekForTest(
  overrides: Partial<TrainingPlanWeek> = {},
): TrainingPlanWeek {
  const weekIndex = overrides.weekIndex ?? 0
  const weekStartDate = overrides.weekStartDate ?? weekStartFor(weekIndex)
  const base: TrainingPlanWeek = {
    id: `week-${weekIndex}`,
    planId: 'plan-1',
    weekIndex,
    weekStartDate,
    phase: 'base',
    status: 'draft',
    sessions: [buildSkeletonSessionForTest({
      date: weekStartDate,
      sessionType: 'running',
      fullyHydrated: true,
    })],
    weekObjectives: [],
    targetLoadBySport: { running: 225 },
    validationIssues: [],
    generationMeta: { attempts: 1 },
    createdAt: 0,
    updatedAt: 0,
  }

  return {
    ...base,
    ...overrides,
    generationMeta: {
      ...base.generationMeta,
      ...overrides.generationMeta,
    },
  }
}
