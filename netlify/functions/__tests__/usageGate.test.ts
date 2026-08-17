import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertUsageGate,
  checkUsagePreflight,
  isKillSwitchActive,
  isUsageLimitsEnabled,
  recordUsageCost,
} from '../_shared/usageGate'

const ENV = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
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

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'free' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'kill_switch_active' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('con limits apagado, no hace fetch y no rechaza', async () => {
    process.env['AI_USAGE_LIMITS_ENABLED'] = 'false'
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'free' })
    expect(result).toBeNull()
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

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({
        statusCode: 429,
        errorCode: 'spend_cap_exceeded',
        detail: { scope: 'account', capUsd: 3 },
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

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({
        statusCode: 429,
        errorCode: 'quota_exceeded',
        detail: { bucketId: 'chat', limit: 120, remaining: 0 },
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

    const result = await assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' })
    expect(result).toEqual({ bucketId: 'chat', limit: 120, usageDate: '2026-08-16' })
  })

  it('clase sin bucket o sin límite para el tier no gatea (lo resuelve entitlement)', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await assertUsageGate({ userId: 'u1', requestClass: 'plan_builder_week', tier: 'free' })
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('spend con forma inesperada falla cerrado (503), no asume gasto cero', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([])   // cero filas: forma inválida para esta RPC
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('spend con campos no numéricos falla cerrado, no los trata como cero', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: null, global_cost_usd: 0 }])
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('un error de red (fetch rechaza) se convierte en server_error, no escapa crudo', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('un cuerpo no-JSON en una respuesta 200 se convierte en server_error, no escapa como SyntaxError', async () => {
    global.fetch = vi.fn(async () => new Response('esto no es json', { status: 200 })) as unknown as typeof fetch

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
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

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
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
        return jsonResponse([{ request_count: 12 }])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight({ userId: 'u1', requestClass: 'plan_builder_week', tier: 'advanced' }))
      .rejects.toMatchObject({ statusCode: 429, errorCode: 'quota_exceeded' })
    const calledIncrement = fetchMock.mock.calls.some(([url]) => String(url).includes('increment_ai_usage_if_under_limit'))
    expect(calledIncrement).toBe(false)
  })

  it('lectura del contador con cuerpo no-JSON falla cerrado', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      if (url.includes('/ai_usage_daily?')) return new Response('no es json', { status: 200 })
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight({ userId: 'u1', requestClass: 'plan_builder_week', tier: 'advanced' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('kill switch activo rechaza antes de cualquier fetch', async () => {
    process.env['AI_KILL_SWITCH_ENABLED'] = 'true'
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight({ userId: 'u1', requestClass: 'plan_builder_week', tier: 'advanced' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'kill_switch_active' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('con limits apagado, no hace fetch y no rechaza', async () => {
    process.env['AI_USAGE_LIMITS_ENABLED'] = 'false'
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight({ userId: 'u1', requestClass: 'plan_builder_week', tier: 'advanced' }))
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

    await expect(checkUsagePreflight({ userId: 'u1', requestClass: 'plan_builder_week', tier: 'advanced' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('lectura del contador con forma no-array falla cerrado', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      if (url.includes('/ai_usage_daily?')) return jsonResponse({ request_count: 12 })
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight({ userId: 'u1', requestClass: 'plan_builder_week', tier: 'advanced' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('cuota bajo el límite permite sin lanzar (camino feliz)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      if (url.includes('/ai_usage_daily?')) return jsonResponse([{ request_count: 3 }])
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight({ userId: 'u1', requestClass: 'plan_builder_week', tier: 'advanced' }))
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
})
