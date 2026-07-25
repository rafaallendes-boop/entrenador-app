import type { HandlerEvent } from '@netlify/functions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AsyncPlanGenerationWriter, PlanGenerationJobTelemetry } from '../../../src/services/planBuilder/asyncGenerationLoop'
import type { TrainingPlan, TrainingPlanWeek } from '../../../src/types/planBuilder'

const jobs: PlanGenerationJobTelemetry[] = []
const writerBehavior: {
  getPlan: () => Promise<TrainingPlan | null>
  putPlan: () => Promise<void>
  putWeek: () => Promise<void>
} = {
  getPlan: async () => null,
  putPlan: async () => {},
  putWeek: async () => {},
}

vi.mock('../_shared/anthropicCaller', () => ({
  callAnthropicForWeek: async () => {
    throw new Error('el worker no debería llamar al proveedor en estos tests')
  },
}))

vi.mock('../_shared/planGenerationShared', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/planGenerationShared')>()
  return {
    ...actual,
    resolveAuthContext: async () => ({ userId: 'user-1', token: 'token-1' }),
    createSupabaseWriter: (): AsyncPlanGenerationWriter => ({
      getPlan: () => writerBehavior.getPlan(),
      putPlan: () => writerBehavior.putPlan(),
      putWeek: () => writerBehavior.putWeek(),
      async putJob(job) {
        jobs.push(job)
      },
    }),
  }
})

const { handler } = await import('../generate-plan-background')

function makeWeek(): TrainingPlanWeek {
  return {
    id: 'week-0',
    planId: 'plan-1',
    weekIndex: 0,
    weekStartDate: '2026-06-01',
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

function makeEvent(weeks: unknown[] = [makeWeek()]): HandlerEvent {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer token-1' },
    body: JSON.stringify({
      plan: { id: 'plan-1', athleteId: 'athlete-1' },
      weeks,
      profile: { id: 'athlete-1', updatedAt: 1 },
      wizardConfig: {},
      jobId: 'plan-bg-job-1',
    }),
  } as unknown as HandlerEvent
}

async function invoke(weeks?: unknown[]) {
  return (await handler(makeEvent(weeks), {} as never, () => undefined)) as { statusCode: number }
}

describe('generate-plan-background job telemetry fallback', () => {
  beforeEach(() => {
    jobs.length = 0
    writerBehavior.getPlan = async () => null
    writerBehavior.putPlan = async () => {}
    writerBehavior.putWeek = async () => {}
  })

  it('emits a failed job when the plan checkpoint fails before the loop starts', async () => {
    writerBehavior.putPlan = async () => {
      throw new Error('supabase down')
    }

    const response = await invoke()

    expect(response.statusCode).toBe(500)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      jobId: 'plan-bg-job-1',
      planId: 'plan-1',
      athleteId: 'athlete-1',
      outcome: 'failed',
      weekCountRequested: 1,
      weekCountSucceeded: 0,
      planCompleteMs: null,
      firstWeekReadyMs: null,
      estimatedCostUsd: null,
    })
    expect(jobs[0].terminalMs).toBeGreaterThanOrEqual(0)
    expect(jobs[0].variant.variantId).toBeTruthy()
  })

  it('emits a failed job when the initial week writes fail', async () => {
    writerBehavior.putWeek = async () => {
      throw new Error('supabase down')
    }

    await invoke()

    expect(jobs).toHaveLength(1)
    expect(jobs[0].outcome).toBe('failed')
  })

  it('emits a failed job when the pre-run plan read fails', async () => {
    writerBehavior.getPlan = async () => {
      throw new Error('supabase down')
    }

    await invoke()

    expect(jobs).toHaveLength(1)
    expect(jobs[0].enqueuedAt).toBe(jobs[0].workerStartedAt)
  })

  it('emits a failed job when the loop preamble throws (week shape passes the payload validator)', async () => {
    // `isGeneratePlanPayload` solo exige `planId`; una semana sin
    // `generationMeta` supera el validator y hace explotar el checkpoint
    // síncrono del loop (`buildSummary → totalAttempts`) antes de su try/finally.
    const malformedWeek: Partial<TrainingPlanWeek> = { ...makeWeek() }
    delete malformedWeek.generationMeta

    const response = await invoke([malformedWeek])

    expect(response.statusCode).toBe(500)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ jobId: 'plan-bg-job-1', outcome: 'failed' })
  })

  it('does not emit a fallback job when the run is deduped', async () => {
    const now = Date.now()
    writerBehavior.getPlan = async () => ({
      id: 'plan-1',
      generationState: 'generating',
      generationSummary: { jobId: 'other-job', startedAt: now, heartbeatAt: now },
    } as unknown as TrainingPlan)

    const response = await invoke()

    expect(response.statusCode).toBe(202)
    expect(jobs).toHaveLength(0)
  })
})
