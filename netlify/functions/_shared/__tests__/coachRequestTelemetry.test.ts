import { describe, expect, it, vi } from 'vitest'

import {
  coachRequestToRow,
  COACH_REQUEST_INSERT_TIMEOUT_MS,
  DETERMINISTIC_BYPASS_MODEL,
  insertCoachRequestRow,
  resolveCoachRequestCostUsd,
  type CoachRequestTelemetry,
} from '../coachRequestTelemetry'

const AT = Date.parse('2026-08-05T12:00:00.000Z')

function makeTelemetry(overrides: Partial<CoachRequestTelemetry> = {}): CoachRequestTelemetry {
  return {
    traceId: 'chat_general-abc',
    userId: '11111111-1111-4111-8111-111111111111',
    requestClass: 'chat_general',
    streamed: true,
    outcome: 'ok',
    authDurationMs: 12,
    serverDurationMs: 900,
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    promptTokens: 1_000_000,
    completionTokens: 1_000_000,
    createdAt: AT,
    ...overrides,
  }
}

describe('resolveCoachRequestCostUsd', () => {
  it('calcula el costo con la tabla fechada cuando el modelo tiene precio', () => {
    expect(resolveCoachRequestCostUsd(makeTelemetry())).toBeCloseTo(18, 6)
  })

  it('devuelve 0 para el bypass determinista, que no llama a ningún proveedor', () => {
    const cost = resolveCoachRequestCostUsd(makeTelemetry({
      model: DETERMINISTIC_BYPASS_MODEL,
      promptTokens: undefined,
      completionTokens: undefined,
    }))
    expect(cost).toBe(0)
  })

  it('devuelve null cuando el modelo no está en MODEL_PRICES', () => {
    expect(resolveCoachRequestCostUsd(makeTelemetry({ model: 'gemini-2.5-flash' }))).toBeNull()
  })

  it('devuelve null cuando el usage es insuficiente aunque el modelo tenga precio', () => {
    const cost = resolveCoachRequestCostUsd(makeTelemetry({
      promptTokens: undefined,
      completionTokens: undefined,
    }))
    expect(cost).toBeNull()
  })

  it('devuelve null cuando falta el modelo', () => {
    expect(resolveCoachRequestCostUsd(makeTelemetry({ model: undefined }))).toBeNull()
  })
})

describe('coachRequestToRow', () => {
  it('mapea a snake_case y estampa created_at como ISO', () => {
    const row = coachRequestToRow(makeTelemetry({ generationId: 'gen-1', logicalAttempt: 2 }))

    expect(row['trace_id']).toBe('chat_general-abc')
    expect(row['generation_id']).toBe('gen-1')
    expect(row['logical_attempt']).toBe(2)
    expect(row['request_class']).toBe('chat_general')
    expect(row['streamed']).toBe(true)
    expect(row['created_at']).toBe(new Date(AT).toISOString())
  })

  it('deja null los campos opcionales ausentes en vez de undefined', () => {
    const row = coachRequestToRow(makeTelemetry({
      generationId: undefined,
      errorCode: undefined,
    }))

    expect(row['generation_id']).toBeNull()
    expect(row['error_code']).toBeNull()
    expect(Object.values(row).every((value) => value !== undefined)).toBe(true)
  })

  it('incluye el costo resuelto', () => {
    const row = coachRequestToRow(makeTelemetry({ model: 'gemini-2.5-flash' }))
    expect(row['estimated_cost_usd']).toBeNull()
  })
})

describe('insertCoachRequestRow', () => {
  function makeClient(result: { error: unknown } | Error) {
    const abortSignal = vi.fn(
      async (signal: AbortSignal): Promise<{ error: unknown }> => {
        void signal
        if (result instanceof Error) throw result
        return result
      },
    )
    const insert = vi.fn((row: Record<string, unknown>) => {
      void row
      return { abortSignal }
    })
    const from = vi.fn((table: string) => {
      void table
      return { insert }
    })
    return { client: { from }, from, insert, abortSignal }
  }

  it('inserta en coach_requests y devuelve ok', async () => {
    const { client, from, insert } = makeClient({ error: null })

    await expect(insertCoachRequestRow(client, makeTelemetry())).resolves.toBe('ok')
    expect(from).toHaveBeenCalledWith('coach_requests')
    expect(insert).toHaveBeenCalledWith(coachRequestToRow(makeTelemetry()))
  })

  it('pide el timeout configurado y pasa ese mismo signal al insert', async () => {
    const controller = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    try {
      const { client, abortSignal } = makeClient({ error: null })

      await insertCoachRequestRow(client, makeTelemetry())

      expect(timeoutSpy).toHaveBeenCalledWith(COACH_REQUEST_INSERT_TIMEOUT_MS)
      expect(abortSignal).toHaveBeenCalledWith(controller.signal)
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it('permite acotar el timeout al presupuesto restante de la Function', async () => {
    const controller = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    try {
      const { client, abortSignal } = makeClient({ error: null })

      await insertCoachRequestRow(client, makeTelemetry(), 750)

      expect(timeoutSpy).toHaveBeenCalledWith(750)
      expect(abortSignal).toHaveBeenCalledWith(controller.signal)
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it('adjunta un AbortSignal real cuando no se espía el built-in', async () => {
    const { client, abortSignal } = makeClient({ error: null })

    await insertCoachRequestRow(client, makeTelemetry())

    expect(abortSignal.mock.calls[0]![0]).toBeInstanceOf(AbortSignal)
  })

  it('se traga un error devuelto y no lanza', async () => {
    const { client } = makeClient({ error: { message: 'aborted', status: 0 } })
    await expect(insertCoachRequestRow(client, makeTelemetry())).resolves.toBe('failed')
  })

  it('se traga una excepción lanzada y no lanza', async () => {
    const { client } = makeClient(new Error('TimeoutError'))
    await expect(insertCoachRequestRow(client, makeTelemetry())).resolves.toBe('failed')
  })

  it('intenta persistir dos requests distintas aunque compartan trace_id', async () => {
    const { client, insert } = makeClient({ error: null })
    const telemetry = makeTelemetry({ traceId: 'trace-reused-by-transport-fallback' })

    await insertCoachRequestRow(client, { ...telemetry, streamed: true, outcome: 'error' })
    await insertCoachRequestRow(client, { ...telemetry, streamed: false, outcome: 'ok' })

    expect(insert).toHaveBeenCalledTimes(2)
    expect(insert.mock.calls[0]?.[0]).toMatchObject({
      trace_id: telemetry.traceId,
      streamed: true,
      outcome: 'error',
    })
    expect(insert.mock.calls[1]?.[0]).toMatchObject({
      trace_id: telemetry.traceId,
      streamed: false,
      outcome: 'ok',
    })
  })
})
