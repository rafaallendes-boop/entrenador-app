import { describe, expect, it } from 'vitest'
import {
  CoachAccessRequiredError,
  formatCoachAccessMessage,
  isCoachAccessReason,
  isCoachAccessRequiredDetail,
} from '../coachAccessError'
import { resolveCapability } from '../resolveCapability'
import { classifyProxyHttpError } from '../../ai/providers/proxyHttpError'

const NOW = 1_700_000_000_000

function decide(over: {
  accountRole: 'athlete' | 'coach' | 'unknown'
  targetAthleteId?: string | null
  membership?: { athleteId: string; role: 'self' | 'coach' } | null
  tier?: 'free' | 'advanced'
}) {
  return resolveCapability({
    actorUserId: 'u1',
    targetAthleteId: over.targetAthleteId ?? null,
    capability: 'chat_action',
    now: NOW,
    entitlement: { tier: over.tier ?? 'advanced', expiresAt: null },
    accountRole: over.accountRole,
    membership: over.membership ?? null,
    roleGate: 'on',
  })
}

describe('denialReason distingue causas que un plan NO resuelve', () => {
  it('un coach sin membresía sobre el atleta deniega por membresía', () => {
    const decision = decide({ accountRole: 'coach', targetAthleteId: 'ath_1' })
    expect(decision.allowed).toBe(false)
    expect(decision.denialReason).toBe('membership')
    expect(isCoachAccessReason(decision.denialReason)).toBe(true)
  })

  it('una membresía `self` no habilita delegación y también es membresía', () => {
    const decision = decide({
      accountRole: 'coach',
      targetAthleteId: 'ath_1',
      membership: { athleteId: 'ath_1', role: 'self' },
    })
    expect(decision.denialReason).toBe('membership')
  })

  it('un atleta que intenta delegar deniega por rol', () => {
    const decision = decide({ accountRole: 'athlete', targetAthleteId: 'ath_1' })
    expect(decision.denialReason).toBe('role')
  })

  it('un rol ilegible deniega por identidad', () => {
    expect(decide({ accountRole: 'unknown' }).denialReason).toBe('identity')
  })

  it('la falta de plan sigue siendo `tier`, que SÍ se resuelve pagando', () => {
    const decision = decide({ accountRole: 'athlete', tier: 'free' })
    expect(decision.allowed).toBe(false)
    expect(decision.denialReason).toBe('tier')
    expect(isCoachAccessReason(decision.denialReason)).toBe(false)
  })

  it('permitido no lleva motivo', () => {
    const decision = decide({ accountRole: 'athlete' })
    expect(decision.allowed).toBe(true)
    expect(decision.denialReason).toBeNull()
  })
})

describe('copy honesto', () => {
  it('ningún mensaje de acceso menciona planes ni invita a pagar', () => {
    for (const reason of ['role', 'membership', 'identity'] as const) {
      const message = formatCoachAccessMessage({ requestClass: 'chat_action', reason })
      expect(message.toLowerCase()).not.toMatch(/plan|avanzado|advanced|sub[ií]|paga/)
    }
  })
})

describe('classifyProxyHttpError', () => {
  it('conserva la causa en vez de aplanar el 403', () => {
    const detail = { requestClass: 'chat_action', reason: 'membership' as const }
    expect(() => classifyProxyHttpError(
      new Response(null, { status: 403 }),
      { error: 'x', errorCode: 'coach_access_required', detail },
    )).toThrow(CoachAccessRequiredError)
  })

  it('un detail malformado no se promueve a error tipado', () => {
    expect(isCoachAccessRequiredDetail({ requestClass: 'c', reason: 'tier' })).toBe(false)
    let thrown: unknown
    try {
      classifyProxyHttpError(
        new Response(null, { status: 403 }),
        { error: 'x', errorCode: 'coach_access_required', detail: { reason: 'tier' } },
      )
    } catch (error) { thrown = error }
    expect(thrown).not.toBeInstanceOf(CoachAccessRequiredError)
  })
})
