import { describe, expect, it } from 'vitest'
import { auditUnavailableShadow, reconcileDecision, resolveCoachAuthzMode } from '../coachAuthzMode'
import { resolveCapability } from '../resolveCapability'

const NOW = 1_700_000_000_000

function pair(over: { accountRole: 'athlete' | 'coach'; tier: 'free' | 'advanced' }) {
  const shared = {
    actorUserId: 'u1', targetAthleteId: null, capability: 'coach_assistant_message' as const,
    now: NOW, entitlement: { tier: over.tier, expiresAt: null }, membership: null,
  }
  return {
    legacy: resolveCapability({ ...shared, accountRole: 'athlete', roleGate: 'off' as const }),
    shadow: resolveCapability({ ...shared, accountRole: over.accountRole, roleGate: 'on' as const }),
  }
}

describe('resolveCoachAuthzMode', () => {
  it('sólo el literal enforce enciende el corte', () => {
    expect(resolveCoachAuthzMode({ COACH_AUTHZ_MODE: 'enforce' })).toBe('enforce')
    for (const value of ['audit', 'ENFORCE', 'true', '', undefined]) {
      expect(resolveCoachAuthzMode({ COACH_AUTHZ_MODE: value })).toBe('audit')
    }
  })
})

describe('reconcileDecision', () => {
  it('atleta advanced: audit conserva permitido y registra wouldDeny', () => {
    const { legacy, shadow } = pair({ accountRole: 'athlete', tier: 'advanced' })
    expect(legacy.allowed).toBe(true)
    expect(shadow.allowed).toBe(false)

    const out = reconcileDecision(legacy, shadow, 'audit')

    expect(out.decision).toBe(legacy)
    expect(out.audit).toMatchObject({ wouldDeny: true, wouldGrant: false })
  })

  it('coach free: audit conserva denegado y registra wouldGrant', () => {
    const { legacy, shadow } = pair({ accountRole: 'coach', tier: 'free' })
    expect(legacy.allowed).toBe(false)
    expect(shadow.allowed).toBe(true)

    const out = reconcileDecision(legacy, shadow, 'audit')

    expect(out.decision).toBe(legacy)
    expect(out.audit).toMatchObject({ wouldDeny: false, wouldGrant: true })
  })

  it('en enforce devuelve la sombra y no emite evento de auditoría', () => {
    const { legacy, shadow } = pair({ accountRole: 'coach', tier: 'free' })
    expect(reconcileDecision(legacy, shadow, 'enforce')).toEqual({ decision: shadow, audit: null })
  })

  it('no registra una coincidencia ni identificadores personales', () => {
    const { legacy, shadow } = pair({ accountRole: 'coach', tier: 'advanced' })
    const out = reconcileDecision(legacy, shadow, 'audit')
    expect(out.audit).toBeNull()

    const difference = reconcileDecision(
      pair({ accountRole: 'coach', tier: 'free' }).legacy,
      pair({ accountRole: 'coach', tier: 'free' }).shadow,
      'audit',
    )
    expect(JSON.stringify(difference.audit)).not.toContain('u1')
  })
})

describe('divergencias de cuota con el mismo `allowed`', () => {
  // La ventana de auditoría existe para saber qué cambiaría `enforce`. Si sólo
  // se registran los cambios de `allowed`, una llamada delegada que pasa a
  // tener tope por atleta —o distinto bucket/límite— no deja evidencia, y es
  // exactamente lo que la Entrega 1b necesita medir.
  function delegated(tier: 'weekly' | 'advanced') {
    const shared = {
      actorUserId: 'u1', capability: 'chat_general' as const, now: NOW,
      entitlement: { tier, expiresAt: null },
    }
    return {
      legacy: resolveCapability({
        ...shared, targetAthleteId: null, accountRole: 'athlete' as const,
        membership: null, roleGate: 'off' as const,
      }),
      shadow: resolveCapability({
        ...shared, targetAthleteId: 'ath_1', accountRole: 'coach' as const,
        membership: { athleteId: 'ath_1', role: 'coach' as const }, roleGate: 'on' as const,
      }),
    }
  }

  it('registra el tope por atleta que sólo aparece en la sombra', () => {
    const { legacy, shadow } = delegated('advanced')
    expect(legacy.allowed).toBe(true)
    expect(shadow.allowed).toBe(true)
    expect(legacy.quotaSubject).toBeNull()
    expect(shadow.quotaSubject).not.toBeNull()

    const out = reconcileDecision(legacy, shadow, 'audit')

    expect(out.decision).toBe(legacy)
    expect(out.audit).toMatchObject({
      wouldDeny: false,
      wouldGrant: false,
      hadSubjectCap: true,
      entitlementSource: 'coach',
      quotaDivergence: ['entitlementSource', 'quotaSubject'],
    })
  })

  it('no inventa divergencia cuando las dos decisiones coinciden en forma', () => {
    const shared = {
      actorUserId: 'u1', targetAthleteId: null, capability: 'chat_general' as const,
      now: NOW, entitlement: { tier: 'advanced' as const, expiresAt: null }, membership: null,
    }
    const legacy = resolveCapability({ ...shared, accountRole: 'athlete', roleGate: 'off' })
    const shadow = resolveCapability({ ...shared, accountRole: 'athlete', roleGate: 'on' })
    expect(reconcileDecision(legacy, shadow, 'audit').audit).toBeNull()
  })
})

describe('auditUnavailableShadow', () => {
  it('conserva la decisión legacy y marca por qué no hubo sombra', () => {
    const { legacy } = pair({ accountRole: 'coach', tier: 'advanced' })
    const out = auditUnavailableShadow(legacy, 'membership_unreadable')

    expect(out.decision).toBe(legacy)
    expect(out.audit).toMatchObject({
      shadowUnavailable: 'membership_unreadable',
      shadowAllowed: null,
      entitlementSource: null,
      wouldDeny: false,
      wouldGrant: false,
      quotaDivergence: [],
    })
  })
})
