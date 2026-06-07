import { describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'
import type { AIRawResponse } from '../../ai/types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { runAsyncPlanGeneration, type AsyncPlanGenerationWriter } from '../asyncGenerationLoop'

function makeRaw(targetDate: string): AIRawResponse {
  return {
    text: JSON.stringify({
      type: 'create_week',
      targetDate,
      reason: 'Semana generada para test',
      weekObjectives: [{ sport: 'squash', goal: 'Technical rhythm' }],
      sessions: [
        {
          date: targetDate,
          timeBlock: 'AM',
          sessionType: 'squash',
          title: 'Squash tecnico',
          durationMin: 60,
          rpe: 6,
          squashDetails: {
            trainingFocus: 'technical',
            sessionMode: 'drill_session',
            sessionKind: 'technical',
            drills: [{ name: 'Drive', durationMin: 12 }],
          },
        },
      ],
    }),
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    traceId: 'trace',
    durationMs: 100,
  }
}

function makeWizardConfig(): PlanWizardConfig {
  return {
    goalEventId: 'event-1',
    trainingDays: ['monday'],
    sessionsPerWeek: 1,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['running', 'strength'],
    currentFitnessLevel: 'normal',
    currentFatigue: 'fresh',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }
}

function makePlan(wizardConfig = makeWizardConfig()): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Plan test',
    startDate: '2026-06-01',
    endDate: '2026-06-14',
    totalWeeks: 2,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-06-14',
      currentPhase: 'build',
      weeksRemaining: 2,
      blockFocus: '',
      headline: '',
      timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeWeek(index: number, startDate: string): TrainingPlanWeek {
  return {
    id: `week-${index}`,
    planId: 'plan-1',
    weekIndex: index,
    weekStartDate: startDate,
    phase: 'build',
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: { squash: 50 },
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeProfile(): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: 1,
    sportContext: { enabledSports: ['squash'], primarySport: 'squash' },
  }
}

function makeWriter(plan: TrainingPlan): AsyncPlanGenerationWriter & { plans: TrainingPlan[]; weeks: TrainingPlanWeek[]; cancelOnRead?: boolean } {
  const state = {
    currentPlan: plan,
    plans: [] as TrainingPlan[],
    weeks: [] as TrainingPlanWeek[],
    cancelOnRead: false,
  }
  return {
    get cancelOnRead() { return state.cancelOnRead },
    set cancelOnRead(value: boolean) { state.cancelOnRead = value },
    plans: state.plans,
    weeks: state.weeks,
    async getPlan() {
      return state.cancelOnRead
        ? { ...state.currentPlan, generationSummary: { ...state.currentPlan.generationSummary!, cancelRequested: true } }
        : state.currentPlan
    },
    async putPlan(next) {
      state.currentPlan = next
      state.plans.push(next)
    },
    async putWeek(next) {
      state.weeks.push(next)
    },
  }
}

describe('runAsyncPlanGeneration', () => {
  it('writes weeks and marks the plan complete', async () => {
    const plan = makePlan()
    const weeks = [makeWeek(0, '2026-06-01'), makeWeek(1, '2026-06-08')]
    const writer = makeWriter(plan)
    const callLLM = vi.fn(async (request) => makeRaw(request.traceId.endsWith('1') ? '2026-06-08' : '2026-06-01'))

    const result = await runAsyncPlanGeneration({
      plan,
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-1',
      writer,
      callLLM,
      now: (() => {
        let ts = 10
        return () => ++ts
      })(),
    })

    expect(callLLM).toHaveBeenCalledTimes(2)
    expect(result.plan.generationState).toBe('complete')
    expect(result.plan.generationSummary?.completedWeeks).toBe(2)
    expect(writer.weeks.filter((week) => week.status === 'draft')).toHaveLength(2)
  })

  it('marks the plan cancelled when cancelRequested is observed', async () => {
    const plan = makePlan()
    const writer = makeWriter({
      ...plan,
      generationSummary: {
        startedAt: 1,
        strategy: 'single',
        completedWeeks: 0,
        failedWeeks: [],
        totalAttempts: 0,
      },
    })
    writer.cancelOnRead = true

    const result = await runAsyncPlanGeneration({
      plan,
      weeks: [makeWeek(0, '2026-06-01')],
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-1',
      writer,
      callLLM: vi.fn(async () => makeRaw('2026-06-01')),
    })

    expect(result.cancelled).toBe(true)
    expect(result.plan.generationState).toBe('cancelled')
    expect(writer.weeks).toHaveLength(0)
  })

  it('completa generación normalmente cuando getPlan lanza un error de red', async () => {
    const plan = makePlan()
    const weeks = [makeWeek(0, '2026-06-01')]

    const throwingWriter: AsyncPlanGenerationWriter & { plans: TrainingPlan[]; weeks: TrainingPlanWeek[] } = {
      plans: [],
      weeks: [],
      async getPlan() { throw new Error('Network error') },
      async putPlan(next) { this.plans.push(next) },
      async putWeek(next) { this.weeks.push(next) },
    }

    const result = await runAsyncPlanGeneration({
      plan,
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-err',
      writer: throwingWriter,
      callLLM: vi.fn(async () => makeRaw('2026-06-01')),
    })

    expect(result.plan.generationState).not.toBe('generating')
    const lastPlan = throwingWriter.plans[throwingWriter.plans.length - 1]
    expect(['complete', 'partial', 'failed']).toContain(lastPlan.generationState)
  })

  it('usa checkCancelled en vez de getPlan cuando está disponible', async () => {
    const plan = makePlan()
    const weeks = [makeWeek(0, '2026-06-01')]

    let checkCancelledCalls = 0
    let getPlanCalls = 0

    const writer: AsyncPlanGenerationWriter & { plans: TrainingPlan[]; weeks: TrainingPlanWeek[] } = {
      plans: [],
      weeks: [],
      async checkCancelled() {
        checkCancelledCalls++
        return false
      },
      async getPlan() {
        getPlanCalls++
        return plan
      },
      async putPlan(next) { this.plans.push(next) },
      async putWeek(next) { this.weeks.push(next) },
    }

    await runAsyncPlanGeneration({
      plan,
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-cc',
      writer,
      callLLM: vi.fn(async () => makeRaw('2026-06-01')),
    })

    expect(checkCancelledCalls).toBe(1)
    expect(getPlanCalls).toBe(0)
  })
})
