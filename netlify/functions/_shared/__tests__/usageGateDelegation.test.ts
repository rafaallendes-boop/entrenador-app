import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertUsageGate, checkUsagePreflight } from '../usageGate'
import type { CapabilityDecision } from '../../../../src/services/entitlements/resolveCapability'

const OLD_ENV = { ...process.env }

function decision(over: Partial<CapabilityDecision> = {}): CapabilityDecision {
  return {
    allowed: true,
    denialReason: null,
    tier: 'advanced',
    capability: 'chat_action',
    requiredTier: 'weekly',
    entitlementSource: 'coach',
    entitlementOwnerUserId: 'u1',
    quotaOwnerUserId: 'u1',
    quotaBucketId: 'chat',
    consumptionUnits: 1,
    limit: 120,
    quotaSubject: { athleteId: 'ath_1', limit: 40 },
    ...over,
  }
}

function pgError(code: string, details: string): Response {
  return new Response(JSON.stringify({ code, message: 'quota_exceeded', details, hint: null }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}

function spendOk(): Response {
  return new Response(JSON.stringify([{ account_cost_usd: 0, global_cost_usd: 0 }]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  process.env['AI_USAGE_LIMITS_ENABLED'] = 'true'
  process.env['AI_KILL_SWITCH_ENABLED'] = 'false'
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'svc'
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...OLD_ENV }
})

describe('clasificación de la reserva', () => {
  function route(rpcResponse: () => Response) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return spendOk()
      expect(url).toContain('/rpc/reserve_ai_usage')
      return rpcResponse()
    }))
  }

  it('45001 detail=account es 429, no 503', async () => {
    route(() => pgError('45001', 'account'))
    await expect(assertUsageGate({ decision: decision() }))
      .rejects.toMatchObject({ statusCode: 429, errorCode: 'quota_exceeded', detail: { scope: 'account', limit: 120 } })
  })

  it('45001 detail=subject es 429 y conserva el scope y tope del atleta', async () => {
    route(() => pgError('45001', 'subject'))
    await expect(assertUsageGate({ decision: decision() }))
      .rejects.toMatchObject({ statusCode: 429, errorCode: 'quota_exceeded', detail: { scope: 'subject', limit: 40 } })
  })

  it('un SQLSTATE desconocido sigue siendo 503', async () => {
    route(() => pgError('P0001', 'lo que sea'))
    await expect(assertUsageGate({ decision: decision() })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('45001 con detail inesperado no se adivina: sigue siendo 503', async () => {
    route(() => pgError('45001', ''))
    await expect(assertUsageGate({ decision: decision() })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('[] es contrato inválido, no cuota agotada: 503', async () => {
    route(() => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(assertUsageGate({ decision: decision() }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })
})

describe('argumentos de la reserva', () => {
  async function capture(d: CapabilityDecision): Promise<{ url: string; body: Record<string, unknown> }> {
    let captured: { url: string; body: Record<string, unknown> } | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return spendOk()
      captured = { url, body: JSON.parse(String(init?.body)) as Record<string, unknown> }
      return new Response(JSON.stringify([{ usage_date: '2026-09-02', request_count: 1 }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))
    await assertUsageGate({ decision: d })
    expect(captured).not.toBeNull()
    return captured!
  }

  it('sin delegación reserva sólo la fila global', async () => {
    const captured = await capture(decision({ quotaSubject: null }))
    expect(captured.url).toContain('/rpc/reserve_ai_usage')
    expect(captured.body).toEqual({
      p_user_id: 'u1',
      p_bucket_id: 'chat',
      p_limit: 120,
      p_subject_athlete_id: null,
      p_subject_limit: null,
    })
  })

  it('con delegación manda sujeto y su tope junto con la reserva global', async () => {
    const captured = await capture(decision())
    expect(captured.url).toContain('/rpc/reserve_ai_usage')
    expect(captured.body).toEqual({
      p_user_id: 'u1',
      p_bucket_id: 'chat',
      p_limit: 120,
      p_subject_athlete_id: 'ath_1',
      p_subject_limit: 40,
    })
  })
})

describe('preflight delegado', () => {
  it('trae global y sujeto en UNA lectura y rechaza el sujeto agotado como 429 subject', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return spendOk()
      urls.push(url)
      return new Response(JSON.stringify([
        { subject_athlete_id: '', request_count: 0 },
        { subject_athlete_id: 'ath_1', request_count: 40 },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    await expect(checkUsagePreflight({ decision: decision() }))
      .rejects.toMatchObject({ statusCode: 429, errorCode: 'quota_exceeded', detail: { scope: 'subject', limit: 40 } })

    // La fila global ya no se pide con `subject_athlete_id=eq.`: ese filtro
    // depende de que PostgREST lea un valor vacío como cadena vacía y, si no
    // lo hiciera, el preflight leería cero y dejaría pasar (fail-OPEN).
    expect(urls).toHaveLength(1)
    expect(urls[0]).not.toContain('subject_athlete_id=eq.')
  })

  it('el tope global se evalúa contra la fila global, no contra la del sujeto', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return spendOk()
      return new Response(JSON.stringify([
        { subject_athlete_id: '', request_count: 120 },
        { subject_athlete_id: 'ath_1', request_count: 0 },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    await expect(checkUsagePreflight({ decision: decision() }))
      .rejects.toMatchObject({ statusCode: 429, detail: { scope: 'account', limit: 120 } })
  })
})
