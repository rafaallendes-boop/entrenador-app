import { describe, expect, it, vi } from 'vitest'
import type { AIRequest } from '../../ai/types'
import type { TrainingPlanWeek } from '../../../types/planBuilder'
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

  function parseWeekIndexFromTraceId(traceId: string): number {
    return Number(traceId.match(/week-(\d+)/)?.[1] ?? -1)
  }

  it('con concurrency 3 (default de producción), un rechazo casi simultáneo en varias semanas en vuelo no duplica las escrituras de las semanas restantes', async () => {
    // Reproduce el escenario del reviewer: concurrency 3, cupo ya agotado,
    // varios workers toman semana cada uno y rechazan por QuotaExceededError
    // casi al mismo tiempo. Sin el guard de un solo disparo,
    // markRemainingWeeksAsUsageGateRejected corría una vez POR worker que
    // rechaza y cada semana restante (no lanzada) recibía hasta N putWeek
    // redundantes en vez de 1. No fijamos cuántos workers alcanzan a
    // lanzarse antes de que `stopLaunching` frene al resto (eso depende del
    // scheduling exacto de microtasks, no del comportamiento bajo prueba):
    // en cambio, derivamos qué semanas se lanzaron realmente del propio mock
    // de `callLLM` y verificamos el conteo de escrituras esperado para cada
    // caso — 2 para una semana lanzada (generating + error), 1 para una
    // semana "remaining" que nunca llegó a invocar al proveedor.
    const { input, base } = makeRunInputForTest({ weekCount: 5, concurrency: 3 })
    const putWeekCallsByIndex = new Map<number, number>()
    const writer: AsyncPlanGenerationWriter = {
      ...base,
      async putWeek(week: TrainingPlanWeek) {
        putWeekCallsByIndex.set(week.weekIndex, (putWeekCallsByIndex.get(week.weekIndex) ?? 0) + 1)
      },
    }
    const launchedWeekIndexes = new Set<number>()
    const callLLM = vi.fn(async (request: AIRequest) => {
      launchedWeekIndexes.add(parseWeekIndexFromTraceId(request.traceId))
      throw new QuotaExceededError({ bucketId: 'plan_builder_week', limit: 12, remaining: 0 })
    })

    const result = await runAsyncPlanGeneration({ ...input, writer, callLLM })

    // Concurrency 3 debe dar lugar a al menos 2 semanas lanzadas casi en
    // paralelo, que es la condición de carrera que este test ejercita.
    expect(launchedWeekIndexes.size).toBeGreaterThanOrEqual(2)
    expect(putWeekCallsByIndex.size).toBe(5)
    for (const [weekIndex, count] of putWeekCallsByIndex) {
      const expectedWrites = launchedWeekIndexes.has(weekIndex) ? 2 : 1
      expect(count).toBe(expectedWrites)
    }
    expect(result.weeks.every((week) => week.status === 'error')).toBe(true)
    expect(result.weeks.every((week) => week.generationMeta.errorClass === 'quota_exceeded')).toBe(true)
  })

  it('con UsageGateUnavailableError concurrente (mensaje por instancia, no fijo), cada semana restante recibe una única escritura coherente', async () => {
    // El caso que más importa de la carrera: a diferencia de las otras 3
    // clases, el mensaje de UsageGateUnavailableError es por instancia. Sin
    // el guard, dos rechazos concurrentes con mensajes distintos podían
    // interleavear sus escrituras sobre las MISMAS semanas restantes,
    // dejando el mensaje final de cada una a merced de cuál escritura ganó
    // la carrera — no necesariamente relacionado con la causa real de esa
    // semana. Con el guard, solo el primer rechazo en llegar escribe las
    // semanas restantes, así que cada una recibe exactamente una escritura y
    // un único mensaje coherente.
    const { input, base } = makeRunInputForTest({ weekCount: 4, concurrency: 2 })
    const putWeekCallsByIndex = new Map<number, number>()
    const writer: AsyncPlanGenerationWriter = {
      ...base,
      async putWeek(week: TrainingPlanWeek) {
        putWeekCallsByIndex.set(week.weekIndex, (putWeekCallsByIndex.get(week.weekIndex) ?? 0) + 1)
      },
    }
    const launchedWeekIndexes = new Set<number>()
    let call = 0
    const callLLM = vi.fn(async (request: AIRequest) => {
      call += 1
      launchedWeekIndexes.add(parseWeekIndexFromTraceId(request.traceId))
      throw new UsageGateUnavailableError(`RPC de cuota devolvió 503 (intento ${call}).`)
    })

    const result = await runAsyncPlanGeneration({ ...input, writer, callLLM })

    expect(launchedWeekIndexes.size).toBeGreaterThanOrEqual(2)
    expect(putWeekCallsByIndex.size).toBe(4)
    for (const [weekIndex, count] of putWeekCallsByIndex) {
      const expectedWrites = launchedWeekIndexes.has(weekIndex) ? 2 : 1
      expect(count).toBe(expectedWrites)
    }
    const remaining = result.weeks.filter((week) => !launchedWeekIndexes.has(week.weekIndex))
    expect(remaining.length).toBeGreaterThan(0)
    expect(remaining.every((week) => week.status === 'error')).toBe(true)
    // El mensaje de cada semana restante viene de UN único rechazo (el que
    // ganó el guard), no de una mezcla entre los dos mensajes por instancia.
    const remainingMessages = new Set(remaining.map((week) => week.generationMeta.lastError))
    expect(remainingMessages.size).toBe(1)
  })
})
