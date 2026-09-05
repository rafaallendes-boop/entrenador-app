import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlerMocks = vi.hoisted(() => ({
  isKillSwitchActive: vi.fn(() => false),
  isUsageLimitsEnabled: vi.fn(() => true),
  assertUsageGate: vi.fn(),
  recordUsageCost: vi.fn(async () => undefined),
  isEntitlementEnforcementEnabled: vi.fn(() => false),
  readEntitlementRecord: vi.fn(async () => ({
    status: 'present' as const,
    row: { tier: 'advanced' as const, expiresAt: null },
    accountRole: 'athlete' as const,
  })),
}))

vi.mock('../_shared/usageGate', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/usageGate')>()
  return {
    ...actual,
    isKillSwitchActive: handlerMocks.isKillSwitchActive,
    isUsageLimitsEnabled: handlerMocks.isUsageLimitsEnabled,
    assertUsageGate: handlerMocks.assertUsageGate,
    recordUsageCost: handlerMocks.recordUsageCost,
  }
})

vi.mock('../_shared/resolveEntitlement', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/resolveEntitlement')>()
  return {
    ...actual,
    isEntitlementEnforcementEnabled: handlerMocks.isEntitlementEnforcementEnabled,
    readEntitlementRecord: handlerMocks.readEntitlementRecord,
  }
})

import { callHandler, callStreamingHandler, stubAuthFetch, stubProviderFetch } from './helpers/coachTestHarness'

/**
 * `validateCoachRequest` (coach.ts) exige `systemPrompt` no vacío — el
 * brief de este test dejaba los bodies sin ese campo. Se agrega acá en
 * todos los bodies para que la request pase validación y realmente ejerza
 * el gate, en vez de fallar antes con 400.
 */
function coachBody(overrides: Record<string, unknown>): Record<string, unknown> {
  return { systemPrompt: 's', ...overrides }
}

describe('coach.ts — usage gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlerMocks.isKillSwitchActive.mockReturnValue(false)
    handlerMocks.isUsageLimitsEnabled.mockReturnValue(true)
    handlerMocks.isEntitlementEnforcementEnabled.mockReturnValue(false)
    handlerMocks.readEntitlementRecord.mockResolvedValue({
      status: 'present',
      row: { tier: 'advanced', expiresAt: null },
      accountRole: 'athlete',
    })
    stubAuthFetch({ userId: 'user-1' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('kill switch activo rechaza antes de invocar al proveedor', async () => {
    handlerMocks.isKillSwitchActive.mockReturnValue(true)
    const providerFetch = stubProviderFetch()

    const response = await callHandler(coachBody({ requestClass: 'chat_general', userMessage: 'hola' }), 'token-1')

    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body).errorCode).toBe('kill_switch_active')
    expect(providerFetch).not.toHaveBeenCalled()
    expect(handlerMocks.assertUsageGate).not.toHaveBeenCalled()
  })

  it('cuota agotada rechaza antes de invocar al proveedor y preserva detail', async () => {
    const gateError = Object.assign(new Error('cupo agotado'), {
      statusCode: 429,
      errorCode: 'quota_exceeded',
      detail: { bucketId: 'chat', limit: 15, remaining: 0 },
    })
    handlerMocks.assertUsageGate.mockRejectedValue(gateError)
    const providerFetch = stubProviderFetch()

    const response = await callHandler(coachBody({ requestClass: 'chat_general', userMessage: 'hola' }), 'token-1')

    expect(response.statusCode).toBe(429)
    const body = JSON.parse(response.body)
    expect(body.errorCode).toBe('quota_exceeded')
    expect(body.detail).toEqual({ bucketId: 'chat', limit: 15, remaining: 0 })
    expect(providerFetch).not.toHaveBeenCalled()
    expect(handlerMocks.assertUsageGate).toHaveBeenCalledWith({
      decision: expect.objectContaining({
        tier: 'advanced',
        quotaOwnerUserId: 'user-1',
        quotaBucketId: 'chat',
        consumptionUnits: 1,
      }),
    })
  })

  it('recalcula el timeout del proveedor DESPUÉS de una latencia real del gate, no reusa el valor pre-gate', async () => {
    // Regresión (hallazgo de revisión externa): `attemptTimeoutMs` se
    // calculaba antes del gate y `armTimeout` reusaba ese mismo valor
    // después, sin descontar lo que el gate tardó — el proveedor recibía su
    // ventana completa otra vez y el wall-clock real podía superar el
    // deadline de la función. Simula una latencia real del gate (~150ms) y
    // confirma, vía la telemetría emitida por `console.info`, que el
    // `attemptTimeoutMs` logueado del intento exitoso es estrictamente menor
    // al que se calcularía sin descontar esa latencia.
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    handlerMocks.assertUsageGate.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150))
      return { bucketId: 'chat', limit: 15, usageDate: '2026-08-16' }
    })
    stubProviderFetch()

    const response = await callHandler(coachBody({ requestClass: 'chat_general', userMessage: 'hola' }), 'token-1')

    expect(response.statusCode).toBe(200)
    const attemptLog = infoSpy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as { event: string; outcome?: string; attemptTimeoutMs?: number })
      .find((entry) => entry.event === 'coach.attempt' && entry.outcome === 'ok')
    expect(attemptLog).toBeDefined()
    // chat_general reparte timeoutMs=15000 entre hasta 2 intentos ⇒ ~7500ms
    // sin descontar el gate. Con 150ms reales de latencia del gate ya
    // consumidos, el valor recalculado tiene que quedar por debajo de eso.
    expect(attemptLog!.attemptTimeoutMs).toBeLessThan(7500)
  })

  it('un retry consume el gate de nuevo, cada intento por separado', async () => {
    handlerMocks.assertUsageGate
      .mockResolvedValueOnce({ bucketId: 'chat', limit: 15, usageDate: '2026-08-16' })
      .mockResolvedValueOnce({ bucketId: 'chat', limit: 15, usageDate: '2026-08-16' })
    stubProviderFetch({ failFirstAttempt: true })

    const response = await callHandler(coachBody({ requestClass: 'chat_general', userMessage: 'hola' }), 'token-1')

    expect(response.statusCode).toBe(200)
    expect(handlerMocks.assertUsageGate).toHaveBeenCalledTimes(2)
  })

  it('el bypass determinista no llama al gate de cuota', async () => {
    const providerFetch = stubProviderFetch()

    const response = await callHandler(
      coachBody({ requestClass: 'chat_action', userMessage: 'pon descanso el lunes' }),
      'token-1',
    )

    expect(response.statusCode).toBe(200)
    expect(handlerMocks.assertUsageGate).not.toHaveBeenCalled()
    expect(providerFetch).not.toHaveBeenCalled()
  })

  // NOTA sobre el body original del brief: no se puede verificar
  // "`isUsageLimitsEnabled` apagado ⇒ `assertUsageGate` nunca se llama",
  // porque coach.ts (por diseño — ver Task 4) llama a `assertUsageGate`
  // incondicionalmente y delega en ESA función la decisión de gatear o no.
  // Acá `assertUsageGate` está mockeada directamente, así que su lógica
  // interna (que sí consulta `isUsageLimitsEnabled`) no corre. Lo que se
  // puede verificar desde coach.ts es el contrato real: cuando el gate
  // resuelve "no gatea" (reservation `null`), la respuesta es normal y no
  // se registra costo.
  it('con el gate desactivado (assertUsageGate resuelve null), responde normal y no registra costo', async () => {
    handlerMocks.isUsageLimitsEnabled.mockReturnValue(false)
    handlerMocks.assertUsageGate.mockResolvedValue(null)
    stubProviderFetch()

    const response = await callHandler(coachBody({ requestClass: 'chat_general', userMessage: 'hola' }), 'token-1')

    expect(response.statusCode).toBe(200)
    expect(handlerMocks.assertUsageGate).toHaveBeenCalledTimes(1)
    expect(handlerMocks.recordUsageCost).not.toHaveBeenCalled()
  })

  it('si el proveedor no reporta tokens, no se registra costo y queda logueada una advertencia', async () => {
    handlerMocks.assertUsageGate.mockResolvedValue({ bucketId: 'chat', limit: 15, usageDate: '2026-08-16' })
    stubProviderFetch({ omitUsage: true })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const response = await callHandler(coachBody({ requestClass: 'chat_general', userMessage: 'hola' }), 'token-1')

    expect(response.statusCode).toBe(200)
    expect(handlerMocks.recordUsageCost).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no reportó usage'))
  })

  it('provider mal configurado (API key ausente) no consume cuota', async () => {
    // chat_general corre en gemini (confirmado en OPTIMIZATION_AND_COSTS.md
    // §8) — resolveApiKey('gemini') lee GEMINI_API_KEY (coach.ts) y lanza
    // 500 'misconfigured' si falta, ANTES de la posición del gate.
    const originalKey = process.env['GEMINI_API_KEY']
    delete process.env['GEMINI_API_KEY']
    const providerFetch = stubProviderFetch()

    try {
      const response = await callHandler(coachBody({ requestClass: 'chat_general', userMessage: 'hola' }), 'token-1')

      expect(response.statusCode).toBe(500)
      expect(JSON.parse(response.body).errorCode).toBe('misconfigured')
      expect(handlerMocks.assertUsageGate).not.toHaveBeenCalled()
      expect(providerFetch).not.toHaveBeenCalled()
    } finally {
      if (originalKey !== undefined) process.env['GEMINI_API_KEY'] = originalKey
    }
  })

  it('el body JSON no-streaming incluye detail para quota_exceeded', async () => {
    const gateError = Object.assign(new Error('cupo agotado'), {
      statusCode: 429,
      errorCode: 'quota_exceeded',
      detail: { bucketId: 'chat', limit: 15, remaining: 0 },
    })
    handlerMocks.assertUsageGate.mockRejectedValue(gateError)

    const response = await callHandler(
      coachBody({ requestClass: 'chat_general', userMessage: 'hola', stream: false }),
      'token-1',
    )

    expect(JSON.parse(response.body).detail).toEqual({ bucketId: 'chat', limit: 15, remaining: 0 })
  })

  it('una falla de infraestructura del gate (503 server_error) no reintenta ni golpea al proveedor dos veces', async () => {
    const gateInfraError = Object.assign(new Error('RPC read_ai_usage_spend devolvió 500.'), {
      statusCode: 503,
      errorCode: 'server_error',
      diagnostics: {
        upstreamStatus: 400,
        upstreamBody: '{"code":"42702","message":"column reference is ambiguous"}',
      },
    })
    handlerMocks.assertUsageGate.mockRejectedValue(gateInfraError)
    const providerFetch = stubProviderFetch()

    const response = await callHandler(coachBody({ requestClass: 'chat_general', userMessage: 'hola' }), 'token-1')

    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body).errorCode).toBe('server_error')
    expect(response.body).not.toContain('42702')
    expect(response.body).not.toContain('ambiguous')
    expect(providerFetch).not.toHaveBeenCalled()
    // No retryable: un solo intento consulta el gate, no dos.
    expect(handlerMocks.assertUsageGate).toHaveBeenCalledTimes(1)
  })

  it('el chunk de error streaming incluye detail para spend_cap_exceeded', async () => {
    const gateError = Object.assign(new Error('presupuesto agotado'), {
      statusCode: 429,
      errorCode: 'spend_cap_exceeded',
      detail: { scope: 'global', capUsd: 5 },
    })
    handlerMocks.assertUsageGate.mockRejectedValue(gateError)

    const chunks = await callStreamingHandler(coachBody({ requestClass: 'chat_general', userMessage: 'hola' }), 'token-1')
    const errorChunk = chunks.map((chunk) => JSON.parse(chunk) as { type: string; detail?: unknown }).find((chunk) => chunk.type === 'error')

    expect(errorChunk?.detail).toEqual({ scope: 'global', capUsd: 5 })
  })
})
