import type { HandlerEvent } from '@netlify/functions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AsyncPlanGenerationWriter } from '../../../src/services/planBuilder/asyncGenerationLoop'
import type { TrainingPlan, TrainingPlanWeek } from '../../../src/types/planBuilder'

const handlerMocks = vi.hoisted(() => ({
  callProvider: vi.fn(),
  createSupabaseWriter: vi.fn(),
  resolveAuthContext: vi.fn(),
  resolveEntitlementTier: vi.fn(),
}))

vi.mock('../_shared/anthropicCaller', () => ({
  callAnthropicForWeek: (...args: unknown[]) => handlerMocks.callProvider(...args),
}))

vi.mock('../_shared/planGenerationShared', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/planGenerationShared')>()
  return {
    ...actual,
    createSupabaseWriter: handlerMocks.createSupabaseWriter,
    resolveAuthContext: handlerMocks.resolveAuthContext,
  }
})

vi.mock('../_shared/resolveEntitlement', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/resolveEntitlement')>()
  return {
    ...actual,
    resolveEntitlementTier: handlerMocks.resolveEntitlementTier,
  }
})

import { handler, terminalizeRejectedJob } from '../generate-plan-background'

const ORIGINAL_ENV = { ...process.env }

function makePlan(jobId: string): TrainingPlan {
  return {
    id: 'plan-1',
    generationState: 'generating',
    updatedAt: 1,
    generationSummary: {
      startedAt: 1,
      jobId,
      strategy: 'single',
      completedWeeks: 0,
      failedWeeks: [],
      totalAttempts: 0,
      heartbeatAt: 1,
    },
  } as unknown as TrainingPlan
}

function makeWeek(): TrainingPlanWeek {
  return {
    id: 'week-0',
    planId: 'plan-1',
    weekIndex: 0,
    weekStartDate: '2026-08-17',
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

function makeEvent(jobId: string | null = 'job-abc'): HandlerEvent {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok-free' },
    body: JSON.stringify({
      plan: { id: 'plan-1', athleteId: 'athlete-1' },
      weeks: [makeWeek()],
      profile: { id: 'athlete-1', updatedAt: 1 },
      wizardConfig: {},
      ...(jobId ? { jobId } : {}),
    }),
  } as unknown as HandlerEvent
}

async function invoke(jobId: string | null = 'job-abc') {
  return await handler(makeEvent(jobId), {} as never, () => undefined) as {
    statusCode: number
    body: string
  }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

describe('terminalizeRejectedJob', () => {
  it('marca failed cuando el jobId coincide y el plan sigue generating', async () => {
    const plan = makePlan('job-abc')
    const putPlan = vi.fn<(plan: TrainingPlan) => Promise<void>>().mockResolvedValue(undefined)
    const writer = { getPlan: vi.fn(async () => plan), putPlan }

    const result = await terminalizeRejectedJob(writer, 'plan-1', 'job-abc')

    expect(result).toBe('marked')
    expect(putPlan).toHaveBeenCalledTimes(1)
    const written = putPlan.mock.calls[0][0]
    expect(written.generationState).toBe('failed')
    expect(written.generationSummary?.completedAt).toBeGreaterThan(0)
  })

  it('no escribe cuando el jobId no coincide', async () => {
    const putPlan = vi.fn(async () => {})
    const writer = { getPlan: vi.fn(async () => makePlan('otro-job')), putPlan }

    await expect(terminalizeRejectedJob(writer, 'plan-1', 'job-abc')).resolves.toBe('skipped')
    expect(putPlan).not.toHaveBeenCalled()
  })

  it('no lee ni escribe cuando no hay jobId', async () => {
    const writer = {
      getPlan: vi.fn(async () => makePlan('job-abc')),
      putPlan: vi.fn(async () => {}),
    }

    await expect(terminalizeRejectedJob(writer, 'plan-1', undefined)).resolves.toBe('skipped')
    expect(writer.getPlan).not.toHaveBeenCalled()
    expect(writer.putPlan).not.toHaveBeenCalled()
  })

  it('no escribe cuando no hay plan persistido', async () => {
    const putPlan = vi.fn(async () => {})
    const writer = { getPlan: vi.fn(async () => null), putPlan }

    await expect(terminalizeRejectedJob(writer, 'plan-1', 'job-abc')).resolves.toBe('skipped')
    expect(putPlan).not.toHaveBeenCalled()
  })

  it('no degrada un plan ya completado aunque coincida el jobId', async () => {
    const completed = {
      ...makePlan('job-abc'),
      generationState: 'complete',
    } as unknown as TrainingPlan
    const putPlan = vi.fn(async () => {})
    const writer = { getPlan: vi.fn(async () => completed), putPlan }

    await expect(terminalizeRejectedJob(writer, 'plan-1', 'job-abc')).resolves.toBe('skipped')
    expect(putPlan).not.toHaveBeenCalled()
  })

  it('no propaga un fallo del cleanup: el rechazo ya ocurrió', async () => {
    const writer = {
      getPlan: vi.fn(async () => makePlan('job-abc')),
      putPlan: vi.fn(async () => { throw new Error('supabase caído') }),
    }

    await expect(terminalizeRejectedJob(writer, 'plan-1', 'job-abc')).resolves.toBe('skipped')
  })
})

describe('generate-plan-background entitlement wiring', () => {
  let getPlan: ReturnType<typeof vi.fn>
  let putPlan: ReturnType<typeof vi.fn>
  let putWeek: ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env['ENTITLEMENTS_ENABLED'] = 'true'
    getPlan = vi.fn(async () => makePlan('job-abc'))
    putPlan = vi.fn(async () => {})
    putWeek = vi.fn(async () => {})
    handlerMocks.createSupabaseWriter.mockReset()
    handlerMocks.createSupabaseWriter.mockReturnValue({
      getPlan,
      putPlan,
      putWeek,
    } as unknown as AsyncPlanGenerationWriter)
    handlerMocks.resolveAuthContext.mockReset()
    handlerMocks.resolveAuthContext.mockResolvedValue({ userId: 'user-free', token: 'tok-free' })
    handlerMocks.resolveEntitlementTier.mockReset()
    handlerMocks.resolveEntitlementTier.mockResolvedValue('free')
    handlerMocks.callProvider.mockReset()
  })

  it('consulta auth y entitlement en paralelo', async () => {
    let resolveAuth!: (value: { userId: string; token: string }) => void
    handlerMocks.resolveAuthContext.mockReturnValue(new Promise((resolve) => {
      resolveAuth = resolve
    }))

    const responsePending = invoke()

    expect(handlerMocks.resolveAuthContext).toHaveBeenCalledTimes(1)
    expect(handlerMocks.resolveEntitlementTier).toHaveBeenCalledWith('tok-free')
    expect(handlerMocks.createSupabaseWriter).not.toHaveBeenCalled()

    resolveAuth({ userId: 'user-free', token: 'tok-free' })
    expect((await responsePending).statusCode).toBe(403)
  })

  it('enqueue aceptado + rechazo del worker terminaliza el job y no genera ni hace writes normales', async () => {
    const response = await invoke()

    expect(response.statusCode).toBe(403)
    expect(JSON.parse(response.body)).toEqual({
      error: 'Esta función requiere el plan advanced.',
      errorCode: 'entitlement_required',
      detail: {
        requestClass: 'plan_builder_week',
        requiredTier: 'advanced',
        currentTier: 'free',
      },
    })
    expect(putPlan).toHaveBeenCalledTimes(1)
    expect(putPlan.mock.calls[0][0]).toMatchObject({ generationState: 'failed' })
    expect(putWeek).not.toHaveBeenCalled()
    expect(handlerMocks.callProvider).not.toHaveBeenCalled()
  })

  it('invocación directa sin job previo no escribe ni llama al proveedor', async () => {
    const response = await invoke(null)

    expect(response.statusCode).toBe(403)
    expect(getPlan).not.toHaveBeenCalled()
    expect(putPlan).not.toHaveBeenCalled()
    expect(putWeek).not.toHaveBeenCalled()
    expect(handlerMocks.callProvider).not.toHaveBeenCalled()
  })

  it('jobId ajeno no terminaliza el plan persistido', async () => {
    getPlan.mockResolvedValue(makePlan('otro-job'))

    const response = await invoke()

    expect(response.statusCode).toBe(403)
    expect(putPlan).not.toHaveBeenCalled()
    expect(putWeek).not.toHaveBeenCalled()
    expect(handlerMocks.callProvider).not.toHaveBeenCalled()
  })

  it('respuesta tardía no degrada un plan ya completado', async () => {
    getPlan.mockResolvedValue({
      ...makePlan('job-abc'),
      generationState: 'complete',
    } as unknown as TrainingPlan)

    const response = await invoke()

    expect(response.statusCode).toBe(403)
    expect(putPlan).not.toHaveBeenCalled()
    expect(putWeek).not.toHaveBeenCalled()
    expect(handlerMocks.callProvider).not.toHaveBeenCalled()
  })
})
