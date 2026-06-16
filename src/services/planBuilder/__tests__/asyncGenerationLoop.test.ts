import { describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'
import type { AIRawResponse } from '../../ai/types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { runAsyncPlanGeneration, type AsyncPlanGenerationWriter } from '../asyncGenerationLoop'

function addWeeksISO(startDate: string, weeks: number): string {
  const date = new Date(`${startDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + weeks * 7)
  return date.toISOString().slice(0, 10)
}

function targetDateFromTrace(traceId: string): string {
  const index = Number(traceId.match(/week-(\d+)/)?.[1] ?? 0)
  return addWeeksISO('2026-06-01', index)
}

function makeRaw(targetDate: string, overrides: Partial<AIRawResponse> = {}): AIRawResponse {
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
    ...overrides,
  }
}

function makeTruncatedRaw(): AIRawResponse {
  return {
    text: JSON.stringify({
      type: 'create_week',
      targetDate: '2026-06-01',
      reason: 'Respuesta cortada',
    }),
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    traceId: 'trace-truncated',
    durationMs: 100,
    finishReason: 'max_tokens',
    truncated: true,
    errorClass: 'truncated',
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
    expect(callLLM.mock.calls[0]?.[0].maxTokens).toBe(5000)
    expect(result.plan.generationState).toBe('complete')
    expect(result.plan.generationSummary?.completedWeeks).toBe(2)
    expect(writer.weeks.filter((week) => week.status === 'draft')).toHaveLength(2)
  })

  it('generates weeks concurrently without exceeding the configured limit', async () => {
    const plan = {
      ...makePlan(),
      totalWeeks: 4,
      endDate: '2026-06-28',
      phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 3, blockFocus: '', intentBySport: {} }],
    } as TrainingPlan
    const weeks = [
      makeWeek(0, '2026-06-01'),
      makeWeek(1, '2026-06-08'),
      makeWeek(2, '2026-06-15'),
      makeWeek(3, '2026-06-22'),
    ]
    const writer = makeWriter(plan)
    let activeCalls = 0
    let maxActiveCalls = 0
    const callLLM = vi.fn(async (request) => {
      activeCalls++
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
      await new Promise((resolve) => setTimeout(resolve, 10))
      activeCalls--
      return makeRaw(targetDateFromTrace(request.traceId))
    })

    const result = await runAsyncPlanGeneration({
      plan,
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-concurrent',
      writer,
      callLLM,
      concurrency: 2,
    })

    expect(callLLM).toHaveBeenCalledTimes(4)
    expect(maxActiveCalls).toBeLessThanOrEqual(2)
    expect(result.plan.generationState).toBe('complete')
    expect(result.plan.generationSummary?.completedWeeks).toBe(4)
  })

  it('reintenta una semana truncada por max_tokens y guarda el resultado exitoso', async () => {
    const plan = makePlan()
    const weeks = [makeWeek(0, '2026-06-01')]
    const writer = makeWriter(plan)
    const callLLM = vi.fn(async () => (
      callLLM.mock.calls.length === 1
        ? makeTruncatedRaw()
        : makeRaw('2026-06-01')
    ))

    const result = await runAsyncPlanGeneration({
      plan,
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-retry',
      writer,
      callLLM,
      maxTokens: 5000,
    })

    const resolvedWeek = result.weeks[0]
    expect(callLLM).toHaveBeenCalledTimes(2)
    expect(callLLM.mock.calls[0]?.[0].maxTokens).toBe(5000)
    expect(callLLM.mock.calls[1]?.[0].maxTokens).toBe(12000)
    expect(callLLM.mock.calls[1]?.[0].userMessage).toContain('max_tokens')
    expect(resolvedWeek.status).toBe('draft')
    expect(resolvedWeek.generationMeta.attempts).toBe(2)
    expect(resolvedWeek.generationMeta.retryUsed).toBe(true)
    expect(result.plan.generationState).toBe('complete')
  })

  it('propaga truncamiento al error final si ambos intentos agotan max_tokens', async () => {
    const plan = makePlan()
    const weeks = [makeWeek(0, '2026-06-01')]
    const writer = makeWriter(plan)
    const callLLM = vi.fn(async () => makeTruncatedRaw())

    const result = await runAsyncPlanGeneration({
      plan,
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-truncated',
      writer,
      callLLM,
      maxTokens: 5000,
    })

    const failedWeek = result.weeks[0]
    expect(callLLM).toHaveBeenCalledTimes(2)
    expect(failedWeek.status).toBe('error')
    expect(failedWeek.generationMeta.attempts).toBe(2)
    expect(failedWeek.generationMeta.errorClass).toBe('truncated')
    expect(failedWeek.generationMeta.lastError).toContain('truncada')
    expect(result.plan.generationState).toBe('failed')
    expect(result.plan.generationSummary?.totalAttempts).toBe(2)
  })

  it('reintenta cuando el proveedor lanza un error técnico y refresca heartbeat entre intentos', async () => {
    const plan = makePlan()
    const weeks = [makeWeek(0, '2026-06-01')]
    const writer = makeWriter(plan)
    const callLLM = vi.fn(async () => {
      if (callLLM.mock.calls.length === 1) {
        throw new Error('Timeout del proveedor claude (120000ms).')
      }
      return makeRaw('2026-06-01')
    })

    const result = await runAsyncPlanGeneration({
      plan,
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-thrown-retry',
      writer,
      callLLM,
    })
    const plansBeforeResolution = writer.plans.length

    const resolvedWeek = result.weeks[0]
    expect(callLLM).toHaveBeenCalledTimes(2)
    expect(resolvedWeek.status).toBe('draft')
    expect(resolvedWeek.generationMeta.attempts).toBe(2)
    expect(resolvedWeek.generationMeta.retryUsed).toBe(true)
    expect(result.plan.generationState).toBe('complete')
    // initial putPlan + checkpoint pre-semana + heartbeat entre intentos + checkpoint post-semana + final
    expect(plansBeforeResolution).toBeGreaterThanOrEqual(5)
  })

  it('no reintenta tras un rate limit del proveedor', async () => {
    const plan = makePlan()
    const weeks = [makeWeek(0, '2026-06-01')]
    const writer = makeWriter(plan)
    const callLLM = vi.fn(async () => {
      throw new Error('rate_limit_error: Too many requests (429).')
    })

    const result = await runAsyncPlanGeneration({
      plan,
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-rate-limit',
      writer,
      callLLM,
    })

    const failedWeek = result.weeks[0]
    expect(callLLM).toHaveBeenCalledTimes(1)
    expect(failedWeek.status).toBe('error')
    expect(failedWeek.generationMeta.errorClass).toBe('rate_limit')
    expect(result.plan.generationState).toBe('failed')
  })

  it('marca las semanas restantes en error cuando se agota el presupuesto del worker', async () => {
    const plan = makePlan()
    const weeks = [makeWeek(0, '2026-06-01'), makeWeek(1, '2026-06-08')]
    const writer = makeWriter(plan)
    const callLLM = vi.fn(async () => makeRaw('2026-06-01'))

    const result = await runAsyncPlanGeneration({
      plan,
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-budget',
      writer,
      callLLM,
      budgetMs: 0,
    })

    expect(callLLM).not.toHaveBeenCalled()
    expect(result.weeks.every((week) => week.status === 'error')).toBe(true)
    expect(result.weeks[0].generationMeta.lastError).toContain('presupuesto')
    expect(result.weeks[0].generationMeta.errorClass).toBe('timeout')
    expect(result.plan.generationState).toBe('failed')
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

  it('stops launching new weeks after cancellation while preserving in-flight weeks', async () => {
    const plan = {
      ...makePlan(),
      totalWeeks: 3,
      endDate: '2026-06-21',
      phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 2, blockFocus: '', intentBySport: {} }],
    } as TrainingPlan
    const weeks = [
      makeWeek(0, '2026-06-01'),
      makeWeek(1, '2026-06-08'),
      makeWeek(2, '2026-06-15'),
    ]
    const writer = makeWriter(plan)
    let cancelChecks = 0
    const writerWithCancel: AsyncPlanGenerationWriter & { plans: TrainingPlan[]; weeks: TrainingPlanWeek[] } = {
      ...writer,
      async checkCancelled() {
        cancelChecks++
        return cancelChecks > 2
      },
    }
    const callLLM = vi.fn(async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return makeRaw(targetDateFromTrace(request.traceId))
    })

    const result = await runAsyncPlanGeneration({
      plan,
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-cancel-in-flight',
      writer: writerWithCancel,
      callLLM,
      concurrency: 2,
    })

    expect(result.cancelled).toBe(true)
    expect(result.plan.generationState).toBe('cancelled')
    expect(callLLM).toHaveBeenCalledTimes(2)
    expect(result.weeks.filter((week) => week.status === 'draft')).toHaveLength(2)
    expect(result.weeks.find((week) => week.weekIndex === 2)?.status).toBe('pending')
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
