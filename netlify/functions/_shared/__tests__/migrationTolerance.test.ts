import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readEntitlementRecord, readVerifiedMembership } from '../resolveEntitlement'
import { assertUsageGate, checkUsagePreflight } from '../usageGate'
import type { CapabilityDecision } from '../../../../src/services/entitlements/resolveCapability'

const OLD_ENV = { ...process.env }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_ANON_KEY'] = 'anon'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service'
  process.env['AI_USAGE_LIMITS_ENABLED'] = 'true'
})

afterEach(() => {
  process.env = { ...OLD_ENV }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Desplegar el bundle antes de una migración manual no puede convertirse en
// 503 para cada request: son migraciones de aplicación manual y ningún flag
// restaura el comportamiento anterior.
describe('028 no aplicada — user_entitlements sin account_role', () => {
  it('reintenta con el contrato anterior y resuelve athlete sin perder el tier', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const href = String(url)
      seen.push(href)
      if (href.includes('account_role')) {
        return json({ code: '42703', message: 'column ... does not exist' }, 400)
      }
      return json([{ user_id: 'u1', tier: 'advanced', expires_at: null }])
    }))

    expect(await readEntitlementRecord('tok')).toEqual({
      status: 'present',
      row: { tier: 'advanced', expiresAt: null },
      accountRole: 'athlete',
    })
    expect(seen).toHaveLength(2)
  })

  it('un 400 que NO es columna ausente sigue siendo unreadable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: '42501' }, 400)))
    expect(await readEntitlementRecord('tok')).toEqual({ status: 'unreadable' })
  })
})

describe('013b no aplicada — athlete_memberships ausente', () => {
  it('trata la tabla ausente como ausencia confirmada, no como fallo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: '42P01' }, 404)))
    expect(await readVerifiedMembership('tok', 'ath_1')).toEqual({ status: 'absent' })
  })

  it('un 500 real sigue siendo unreadable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'boom' }, 500)))
    expect(await readVerifiedMembership('tok', 'ath_1')).toEqual({ status: 'unreadable' })
  })
})

function decision(over: Partial<CapabilityDecision> = {}): CapabilityDecision {
  return {
    allowed: true,
    denialReason: null,
    tier: 'advanced',
    capability: 'chat_action',
    requiredTier: 'weekly',
    entitlementSource: 'self',
    entitlementOwnerUserId: 'u1',
    quotaOwnerUserId: 'u1',
    quotaBucketId: 'chat',
    consumptionUnits: 1,
    limit: 120,
    quotaSubject: null,
    ...over,
  }
}

const spendOk = () => json([{ account_cost_usd: 0, global_cost_usd: 0 }])

describe('029 no aplicada — reserve_ai_usage ausente', () => {
  it('sin tope por atleta cae al incrementador anterior', async () => {
    const called: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes('read_ai_usage_spend')) return spendOk()
      if (href.includes('reserve_ai_usage')) {
        called.push('reserve')
        return json({ code: 'PGRST202', message: 'Could not find the function' }, 404)
      }
      called.push('legacy')
      return json([{ usage_date: '2026-09-03', request_count: 1 }])
    }))

    await expect(assertUsageGate({ decision: decision() })).resolves.toMatchObject({
      bucketId: 'chat',
      usageDate: '2026-09-03',
    })
    expect(called).toEqual(['reserve', 'legacy'])
  })

  it('el contrato anterior conserva [] como cuota agotada', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes('read_ai_usage_spend')) return spendOk()
      if (href.includes('reserve_ai_usage')) return json({ code: 'PGRST202' }, 404)
      return json([])
    }))

    await expect(assertUsageGate({ decision: decision() }))
      .rejects.toMatchObject({ statusCode: 429, errorCode: 'quota_exceeded' })
  })

  it('CON tope por atleta falla cerrado: la reserva dual no es sustituible', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes('read_ai_usage_spend')) return spendOk()
      if (href.includes('reserve_ai_usage')) return json({ code: 'PGRST202' }, 404)
      throw new Error(`no debe llamar al contrato anterior: ${href}`)
    }))

    await expect(assertUsageGate({
      decision: decision({ quotaSubject: { athleteId: 'ath_1', limit: 40 } }),
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('el preflight cae al select sin subject_athlete_id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes('read_ai_usage_spend')) return spendOk()
      if (href.includes('subject_athlete_id')) return json({ code: '42703' }, 400)
      return json([{ request_count: 200 }])
    }))

    await expect(checkUsagePreflight({ decision: decision() }))
      .rejects.toMatchObject({ statusCode: 429, errorCode: 'quota_exceeded' })
  })
})

describe('preflight sin filtro ambiguo por sujeto', () => {
  it('no filtra subject_athlete_id en la URL y reparte las filas en memoria', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes('read_ai_usage_spend')) return spendOk()
      urls.push(href)
      return json([
        { subject_athlete_id: '', request_count: 5 },
        { subject_athlete_id: 'ath_1', request_count: 40 },
      ])
    }))

    await expect(checkUsagePreflight({
      decision: decision({ quotaSubject: { athleteId: 'ath_1', limit: 40 } }),
    })).rejects.toMatchObject({ statusCode: 429, detail: { scope: 'subject', limit: 40 } })

    expect(urls).toHaveLength(1)
    expect(urls[0]).not.toContain('subject_athlete_id=eq.')
  })
})
