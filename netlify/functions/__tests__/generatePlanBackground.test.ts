import type { HandlerEvent } from '@netlify/functions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AsyncPlanGenerationWriter, PlanGenerationJobTelemetry } from '../../../src/services/planBuilder/asyncGenerationLoop'
import { buildVariantId } from '../../../src/services/planBuilder/telemetryVersions'
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

vi.mock('../../../src/services/planBuilder/qualityReview', async (importActual) => {
  const actual = await importActual<typeof import('../../../src/services/planBuilder/qualityReview')>()
  return { ...actual, PRODUCTIVE_QUALITY_VERSION: 2 as const }
})

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

  it('labels the variant with the run quality version, not the global constant', async () => {
    // Semana legacy ya lista fuera de los targets: la corrida es v1 aunque la
    // constante productiva mockeada sea 2.
    writerBehavior.putPlan = async () => {
      throw new Error('supabase down')
    }

    await invoke([
      {
        ...makeWeek(),
        weekIndex: 0,
        status: 'draft',
        sessions: [{}],
        generationMeta: { attempts: 1 },
      },
      { ...makeWeek(), id: 'week-1', weekIndex: 1 },
    ])

    expect(jobs).toHaveLength(1)
    expect(jobs[0].variant.qualityVersion).toBe(1)
    expect(jobs[0].variant.variantId).toBe(buildVariantId(jobs[0].variant))
  })

  it('installs unstarted-job telemetry before a malformed ready week can fail', async () => {
    // El validator acepta esta fila por `planId`, pero falta metadata. El
    // resolver defensivo la trata como legacy/v1; el fallo posterior del
    // checkpoint del loop todavía debe producir una fila de job.
    const malformedReadyWeek: Partial<TrainingPlanWeek> = {
      ...makeWeek(),
      status: 'draft',
      sessions: [{}] as TrainingPlanWeek['sessions'],
    }
    delete malformedReadyWeek.generationMeta

    const response = await invoke([malformedReadyWeek])

    expect(response.statusCode).toBe(500)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      jobId: 'plan-bg-job-1',
      outcome: 'failed',
      variant: { qualityVersion: 1 },
    })
    expect(jobs[0].variant.variantId).toBe(buildVariantId(jobs[0].variant))
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
