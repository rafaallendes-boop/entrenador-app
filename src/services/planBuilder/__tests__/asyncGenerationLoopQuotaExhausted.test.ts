import { describe, expect, it, vi } from 'vitest'
import type { AIRequest } from '../../ai/types'
import {
  runAsyncPlanGeneration,
  type AsyncPlanGenerationWriter,
  type PlanGenerationJobTelemetry,
  type PlanGenerationJobVariant,
} from '../asyncGenerationLoop'
import {
  KillSwitchActiveError,
  QuotaExceededError,
  SpendCapExceededError,
  UsageGateUnavailableError,
} from '../../entitlements/usageGateError'
import { makeRunInputForTest } from './helpers/asyncLoopTestFixtures'

const VARIANT: PlanGenerationJobVariant = {
  provider: 'claude', model: 'claude-sonnet-4-6', effort: 'omitted', thinkingMode: 'omitted',
  temperature: 0.25, maxTokens: 5000, promptVersion: 'v', schemaVersion: 'v',
  qualityVersion: 1, concurrency: 1, variantId: 's46-q1-abcd1234',
}

function collecting(base: AsyncPlanGenerationWriter): { writer: AsyncPlanGenerationWriter; jobs: PlanGenerationJobTelemetry[] } {
  const jobs: PlanGenerationJobTelemetry[] = []
  return {
    jobs,
    writer: {
      ...base,
      async putJob(job: PlanGenerationJobTelemetry) {
        jobs.push(job)
      },
    } as AsyncPlanGenerationWriter,
  }
}

describe('asyncGenerationLoop — quota_exhausted', () => {
  it('un rechazo de cuota en attempt 1 no dispara attempt 2 y no se trata como provider_failed', async () => {
    const { input } = makeRunInputForTest({ weekCount: 1, concurrency: 1 })
    const callLLM = vi.fn(async () => {
      throw new QuotaExceededError({ bucketId: 'plan_builder_week', limit: 12, remaining: 0 })
    })

    const result = await runAsyncPlanGeneration({ ...input, callLLM })

    expect(callLLM).toHaveBeenCalledTimes(1)
    const finalWeek = result.weeks.find((week) => week.weekIndex === 0)
    expect(finalWeek?.status).toBe('error')
    expect(finalWeek?.generationMeta.errorClass).not.toBe('provider_failed')
    expect(finalWeek?.generationMeta.errorClass).toBe('quota_exceeded')
  })

  it('rechazo de cuota detiene el lanzamiento de semanas siguientes del mismo job', async () => {
    const { input } = makeRunInputForTest({ weekCount: 3, concurrency: 1 })
    const callLLM = vi.fn(async () => {
      throw new QuotaExceededError({ bucketId: 'plan_builder_week', limit: 12, remaining: 0 })
    })

    const result = await runAsyncPlanGeneration({ ...input, callLLM })

    // Con concurrencia 1 y rechazo en la primera semana, las 2 restantes no
    // deben llegar a invocar callLLM.
    expect(callLLM).toHaveBeenCalledTimes(1)
    const remaining = result.weeks.filter((week) => week.weekIndex > 0)
    expect(remaining).toHaveLength(2)
    expect(remaining.every((week) => week.status === 'error')).toBe(true)
    expect(remaining.every((week) => week.generationMeta.errorClass === 'quota_exceeded')).toBe(true)
  })

  it('el job queda con outcome quota_exhausted', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 1, concurrency: 1 })
    const { writer, jobs } = collecting(base)
    const callLLM = vi.fn(async () => {
      throw new QuotaExceededError({ bucketId: 'plan_builder_week', limit: 12, remaining: 0 })
    })

    await runAsyncPlanGeneration({ ...input, writer, callLLM, variant: VARIANT })

    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.outcome).toBe('quota_exhausted')
  })

  it('spend_cap_exceeded produce outcome failed, no quota_exhausted', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 1, concurrency: 1 })
    const { writer, jobs } = collecting(base)
    const callLLM = vi.fn(async () => {
      throw new SpendCapExceededError({ scope: 'global', capUsd: 5 })
    })

    await runAsyncPlanGeneration({ ...input, writer, callLLM, variant: VARIANT })

    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.outcome).toBe('failed')
  })

  it('kill_switch_active produce outcome failed, aunque otra semana del mismo job ya haya tenido éxito', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 2, concurrency: 1 })
    const { writer, jobs } = collecting(base)
    const originalCallLLM = input.callLLM
    let call = 0
    const callLLM = vi.fn(async (request: AIRequest) => {
      call += 1
      if (call === 1) return originalCallLLM(request)
      throw new KillSwitchActiveError()
    })

    await runAsyncPlanGeneration({ ...input, writer, callLLM, variant: VARIANT })

    // Una semana exitosa no basta para 'partial': el spec pide 'failed' sin
    // matices cuando la causa es spend cap o kill switch.
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.outcome).toBe('failed')
    expect(jobs[0]?.weekCountSucceeded).toBeGreaterThan(0)
  })

  it('UsageGateUnavailableError (falla de infraestructura del gate) produce un solo intento, cero fallback y outcome failed', async () => {
    // Agregado tras revisión (P2, ronda 4): Task 7 implementa el
    // reconocimiento de esta 4ª clase (isUsageGateRejection la incluye), pero
    // no había ningún test que lo ejercitara — solo las otras 3 estaban
    // cubiertas.
    const { input, base } = makeRunInputForTest({ weekCount: 1, concurrency: 1 })
    const { writer, jobs } = collecting(base)
    const callLLM = vi.fn(async () => {
      throw new UsageGateUnavailableError('RPC de cuota devolvió 503.')
    })

    const result = await runAsyncPlanGeneration({ ...input, writer, callLLM, variant: VARIANT })

    // Un solo intento: no se trata como fallo del proveedor, así que no
    // dispara el segundo attempt de generateWeekCoreWithRetry ni ningún
    // fallback a otro proveedor.
    expect(callLLM).toHaveBeenCalledTimes(1)
    const finalWeek = result.weeks.find((week) => week.weekIndex === 0)
    expect(finalWeek?.status).toBe('error')
    expect(finalWeek?.generationMeta.errorClass).toBe('server_error')
    expect(finalWeek?.generationMeta.lastError).toBe('RPC de cuota devolvió 503.')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.outcome).toBe('failed')
  })
})
