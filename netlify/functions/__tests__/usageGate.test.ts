import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertUsageGate,
  checkUsagePreflight,
  isKillSwitchActive,
  isUsageLimitsEnabled,
  recordUsageCost,
} from '../_shared/usageGate'
import { resolveCapability, type CapabilityDecision } from '../../../src/services/entitlements/resolveCapability'
import type { AIRequestClass } from '../../../src/types'
import type { Tier } from '../../../src/services/entitlements/entitlementPolicy'

const ENV = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function gateInput(
  capability: AIRequestClass,
  tier: Tier,
  overrides: Partial<CapabilityDecision> = {},
): { decision: CapabilityDecision } {
  return {
    decision: {
      ...resolveCapability({
        actorUserId: 'u1',
        targetAthleteId: null,
        capability,
        now: 0,
        entitlement: { tier, expiresAt: null },
      }),
      ...overrides,
    },
  }
}

describe('flags', () => {
  it('isKillSwitchActive solo se activa con el literal true', () => {
    expect(isKillSwitchActive({ AI_KILL_SWITCH_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true)
    expect(isKillSwitchActive({ AI_KILL_SWITCH_ENABLED: 'TRUE' } as NodeJS.ProcessEnv)).toBe(false)
    expect(isKillSwitchActive({} as NodeJS.ProcessEnv)).toBe(false)
  })

  it('isUsageLimitsEnabled solo se activa con el literal true', () => {
    expect(isUsageLimitsEnabled({ AI_USAGE_LIMITS_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true)
    expect(isUsageLimitsEnabled({} as NodeJS.ProcessEnv)).toBe(false)
  })
})

describe('assertUsageGate', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env['SUPABASE_URL'] = ENV.SUPABASE_URL
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = ENV.SUPABASE_SERVICE_ROLE_KEY
    process.env['AI_USAGE_LIMITS_ENABLED'] = 'true'
    process.env['AI_KILL_SWITCH_ENABLED'] = 'false'
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('kill switch activo rechaza antes de cualquier fetch', async () => {
    process.env['AI_KILL_SWITCH_ENABLED'] = 'true'
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate(gateInput('chat_general', 'free')))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'kill_switch_active' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('con limits apagado, no hace fetch y no rechaza', async () => {
    process.env['AI_USAGE_LIMITS_ENABLED'] = 'false'
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await assertUsageGate(gateInput('chat_general', 'free'))
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('con limits apagado no valida una decisión malformada', async () => {
    process.env['AI_USAGE_LIMITS_ENABLED'] = 'false'
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate(gateInput('chat_general', 'free', {
      consumptionUnits: 2,
      quotaOwnerUserId: '',
      quotaBucketId: null,
      limit: null,
    }))).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('spend cap por cuenta ya alcanzado rechaza antes del incremento de cuota', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) {
        return jsonResponse([{ account_cost_usd: 3.2, global_cost_usd: 1 }])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate(gateInput('chat_general', 'weekly')))
      .rejects.toMatchObject({
        statusCode: 429,
        errorCode: 'spend_cap_exceeded',
        detail: { scope: 'account', capUsd: 0.8 },
      })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('incremento atómico sin filas devueltas rechaza con quota_exceeded', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) {
        return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      }
      if (url.includes('/rpc/increment_ai_usage_if_under_limit')) {
        return jsonResponse([])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate(gateInput('chat_general', 'weekly')))
      .rejects.toMatchObject({
        statusCode: 429,
        errorCode: 'quota_exceeded',
        detail: { bucketId: 'chat', limit: 40, remaining: 0 },
      })
  })

  it('incremento atómico con fila devuelta permite y expone usageDate/bucketId', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) {
        return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      }
      if (url.includes('/rpc/increment_ai_usage_if_under_limit')) {
        return jsonResponse([{ usage_date: '2026-08-16', request_count: 1 }])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await assertUsageGate(gateInput('chat_general', 'weekly'))
    expect(result).toEqual({ bucketId: 'chat', limit: 40, usageDate: '2026-08-16' })
  })

  it('usa estrictamente el dueño y límite de la decisión, con bucket ligado a su capacidad', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/rpc/read_ai_usage_spend')) {
        expect(JSON.parse(String(init?.body))).toEqual({ p_user_id: 'coach-owner' })
        return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      }
      if (url.includes('/rpc/increment_ai_usage_if_under_limit')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          p_user_id: 'coach-owner', p_bucket_id: 'chat', p_limit: 7,
        })
        return jsonResponse([{ usage_date: '2026-08-16', request_count: 1 }])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await assertUsageGate(gateInput('chat_general', 'weekly', {
      quotaOwnerUserId: 'coach-owner',
      quotaBucketId: 'chat',
      limit: 7,
    }))
  })

  it('un consumo distinto de un intento falla cerrado sin tocar Supabase', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate(gateInput('chat_general', 'weekly', { consumptionUnits: 2 })))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['dueño vacío', { quotaOwnerUserId: '' }],
    ['bucket ausente', { quotaBucketId: null }],
    ['límite no positivo', { limit: 0 }],
    ['bucket que no corresponde a la capability', { capability: 'plan_builder_week' as const }],
  ] as const)('una decisión con %s falla cerrada sin tocar Supabase', async (_case, overrides) => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate(gateInput('chat_general', 'weekly', overrides)))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clase sin bucket o sin límite para el tier no gatea (lo resuelve entitlement)', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await assertUsageGate(gateInput('plan_builder_week', 'free'))
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('spend con forma inesperada falla cerrado (503), no asume gasto cero', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([])   // cero filas: forma inválida para esta RPC
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate(gateInput('chat_general', 'weekly')))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('spend con campos no numéricos falla cerrado, no los trata como cero', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: null, global_cost_usd: 0 }])
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate(gateInput('chat_general', 'weekly')))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('un error de red (fetch rechaza) se convierte en server_error, no escapa crudo', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch

    await expect(assertUsageGate(gateInput('chat_general', 'weekly')))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('un cuerpo no-JSON en una respuesta 200 se convierte en server_error, no escapa como SyntaxError', async () => {
    global.fetch = vi.fn(async () => new Response('esto no es json', { status: 200 })) as unknown as typeof fetch

    await expect(assertUsageGate(gateInput('chat_general', 'weekly')))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('conserva y registra el body truncado de PostgREST sólo como diagnóstico', async () => {
    const upstreamBody = JSON.stringify({
      code: '42702',
      message: 'column reference "usage_date" is ambiguous',
      details: null,
      hint: null,
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) {
        return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      }
      if (url.includes('/rpc/increment_ai_usage_if_under_limit')) {
        return new Response(`${upstreamBody}${'x'.repeat(2_100)}`, { status: 400 })
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    let thrown: unknown
    try {
      await assertUsageGate(gateInput('chat_general', 'weekly'))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      statusCode: 503,
      errorCode: 'server_error',
      diagnostics: {
        upstreamStatus: 400,
        upstreamBody: expect.stringContaining('42702'),
      },
    })
    expect((thrown as { message: string }).message).not.toContain('42702')
    expect((thrown as { diagnostics: { upstreamBody: string } }).diagnostics.upstreamBody)
      .toHaveLength(2_000)
    expect(errorSpy).toHaveBeenCalledWith(
      '[usage-gate] RPC failed',
      expect.objectContaining({
        functionName: 'increment_ai_usage_if_under_limit',
        diagnostics: expect.objectContaining({ upstreamStatus: 400 }),
      }),
    )
  })

  it('el incremento con más de una fila devuelta falla cerrado (cardinalidad estricta)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      if (url.includes('/rpc/increment_ai_usage_if_under_limit')) {
        return jsonResponse([{ usage_date: '2026-08-16', request_count: 1 }, { usage_date: '2026-08-16', request_count: 1 }])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate(gateInput('chat_general', 'weekly')))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })
})

describe('checkUsagePreflight', () => {
  beforeEach(() => {
    process.env['SUPABASE_URL'] = ENV.SUPABASE_URL
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = ENV.SUPABASE_SERVICE_ROLE_KEY
    process.env['AI_USAGE_LIMITS_ENABLED'] = 'true'
    process.env['AI_KILL_SWITCH_ENABLED'] = 'false'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cuota ya en el límite rechaza sin incrementar nada', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) {
        return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      }
      if (url.includes('/ai_usage_daily?')) {
        return jsonResponse([{ request_count: 16 }])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight(gateInput('plan_builder_week', 'advanced')))
      .rejects.toMatchObject({ statusCode: 429, errorCode: 'quota_exceeded' })
    const calledIncrement = fetchMock.mock.calls.some(([url]) => String(url).includes('increment_ai_usage_if_under_limit'))
    expect(calledIncrement).toBe(false)
  })

  it('preflight usa el dueño y límite de la decisión sin re-resolverlos', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/rpc/read_ai_usage_spend')) {
        expect(JSON.parse(String(init?.body))).toEqual({ p_user_id: 'coach-owner' })
        return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      }
      if (url.includes('/ai_usage_daily?')) {
        const params = new URL(url).searchParams
        expect(params.get('user_id')).toBe('eq.coach-owner')
        expect(params.get('bucket_id')).toBe('eq.chat')
        return jsonResponse([{ request_count: 6 }])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight(gateInput('chat_general', 'weekly', {
      quotaOwnerUserId: 'coach-owner',
      quotaBucketId: 'chat',
      limit: 7,
    }))).resolves.toBeUndefined()
  })

  it('lectura del contador con cuerpo no-JSON falla cerrado', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      if (url.includes('/ai_usage_daily?')) return new Response('no es json', { status: 200 })
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight(gateInput('plan_builder_week', 'advanced')))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('kill switch activo rechaza antes de cualquier fetch', async () => {
    process.env['AI_KILL_SWITCH_ENABLED'] = 'true'
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight(gateInput('plan_builder_week', 'advanced')))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'kill_switch_active' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('con limits apagado, no hace fetch y no rechaza', async () => {
    process.env['AI_USAGE_LIMITS_ENABLED'] = 'false'
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight(gateInput('plan_builder_week', 'advanced')))
      .resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('un error de red en la lectura propia de ai_usage_daily se convierte en server_error', async () => {
    // A diferencia del error de red ya cubierto para callRpc, esta lectura es
    // un GET directo a PostgREST (no pasa por callRpc), así que necesita su
    // propio caso: confirma que el try/catch de checkUsagePreflight alrededor
    // de SU fetch también convierte el rechazo, no solo el de las RPC.
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      if (url.includes('/ai_usage_daily?')) throw new TypeError('fetch failed')
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight(gateInput('plan_builder_week', 'advanced')))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('lectura del contador con forma no-array falla cerrado', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      if (url.includes('/ai_usage_daily?')) return jsonResponse({ request_count: 12 })
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight(gateInput('plan_builder_week', 'advanced')))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('cuota bajo el límite permite sin lanzar (camino feliz)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      if (url.includes('/ai_usage_daily?')) return jsonResponse([{ request_count: 3 }])
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight(gateInput('plan_builder_week', 'advanced')))
      .resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('recordUsageCost', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env['SUPABASE_URL'] = ENV.SUPABASE_URL
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = ENV.SUPABASE_SERVICE_ROLE_KEY
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('llama a la RPC atómica de acumulación, no a un PATCH que sobreescribe', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => jsonResponse([{ estimated_cost_usd: 0.05 }]),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await recordUsageCost({ userId: 'u1', bucketId: 'chat', usageDate: '2026-08-16', costUsd: 0.02 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/rpc/increment_ai_usage_cost')
    expect(JSON.parse(init.body as string)).toEqual({
      p_user_id: 'u1', p_bucket_id: 'chat', p_usage_date: '2026-08-16', p_delta: 0.02,
    })
  })

  it('es best-effort: un fetch fallido no lanza', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch

    await expect(recordUsageCost({ userId: 'u1', bucketId: 'chat', usageDate: '2026-08-16', costUsd: 0.01 }))
      .resolves.toBeUndefined()
  })

  it('costo <= 0 no hace fetch', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await recordUsageCost({ userId: 'u1', bucketId: 'chat', usageDate: '2026-08-16', costUsd: 0 })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cero filas afectadas se loguea, no se ignora en silencio', async () => {
    global.fetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await recordUsageCost({ userId: 'u1', bucketId: 'chat', usageDate: '2026-08-16', costUsd: 0.02 })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no confirmó un valor válido'))
  })

  it('una fila con estimated_cost_usd negativo o ausente también se loguea, no cuenta como éxito', async () => {
    global.fetch = vi.fn(async () => jsonResponse([{ estimated_cost_usd: -1 }])) as unknown as typeof fetch
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await recordUsageCost({ userId: 'u1', bucketId: 'chat', usageDate: '2026-08-16', costUsd: 0.02 })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no confirmó un valor válido'))
  })

  it('timeoutMs <= 0 salta el fetch directamente y loguea (sin presupuesto de wallclock)', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await recordUsageCost({ userId: 'u1', bucketId: 'chat', usageDate: '2026-08-16', costUsd: 0.02, timeoutMs: 0 })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sin presupuesto de wallclock restante'))
  })

  it('un timeoutMs positivo se respeta (no usa el default fijo)', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => jsonResponse([{ estimated_cost_usd: 0.05 }]),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await recordUsageCost({ userId: 'u1', bucketId: 'chat', usageDate: '2026-08-16', costUsd: 0.02, timeoutMs: 500 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
