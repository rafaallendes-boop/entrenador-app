import { describe, expect, it } from 'vitest'
import { resolveCapability } from '../resolveCapability'

const NOW = 1_700_000_000_000
const ADVANCED = { tier: 'advanced' as const, expiresAt: null }
const FREE = { tier: 'free' as const, expiresAt: null }

function decide(over: Partial<Parameters<typeof resolveCapability>[0]> = {}) {
  return resolveCapability({
    actorUserId: 'user-1', targetAthleteId: null, capability: 'chat_general',
    now: NOW, entitlement: ADVANCED, accountRole: 'athlete', membership: null,
    roleGate: 'on', ...over,
  })
}

describe('roleGate off reproduce el comportamiento legacy', () => {
  it('ignora el rol por completo', () => {
    expect(decide({ roleGate: 'off', accountRole: 'unknown' }).allowed).toBe(true)
    expect(decide({ roleGate: 'off', accountRole: 'coach' }).allowed).toBe(true)
  })

  it('coach_assistant_message sigue exigiendo advanced y NO rol', () => {
    expect(decide({ roleGate: 'off', capability: 'coach_assistant_message', accountRole: 'athlete', entitlement: ADVANCED }).allowed).toBe(true)
    expect(decide({ roleGate: 'off', capability: 'coach_assistant_message', accountRole: 'coach', entitlement: FREE }).allowed).toBe(false)
  })

  it('nunca delega, aunque le pasen objetivo y membresía', () => {
    const d = decide({
      roleGate: 'off', accountRole: 'coach', targetAthleteId: 'ath_1',
      membership: { athleteId: 'ath_1', role: 'coach' },
    })
    expect(d.entitlementSource).toBe('self')
    expect(d.quotaSubject).toBeNull()
  })
})

describe('roleGate on — delegación', () => {
  it('coach sobre atleta vinculado cobra al coach y fija el sujeto', () => {
    const d = decide({
      capability: 'chat_action', accountRole: 'coach', targetAthleteId: 'ath_1',
      membership: { athleteId: 'ath_1', role: 'coach' },
    })
    expect(d.allowed).toBe(true)
    expect(d.entitlementSource).toBe('coach')
    expect(d.quotaOwnerUserId).toBe('user-1')
    expect(d.quotaSubject).toEqual({ athleteId: 'ath_1', limit: 40 })
    expect(d.quotaBucketId).toBe('chat')  // canónico: usageGate compara por igualdad
  })

  it('objetivo sin membresía DENIEGA; nunca recae en "sobre sí mismo"', () => {
    const d = decide({ capability: 'chat_action', accountRole: 'coach', targetAthleteId: 'ath_1', membership: null })
    expect(d.allowed).toBe(false)
    expect(d.quotaSubject).toBeNull()
    expect(d.quotaBucketId).toBeNull()
  })

  it('membresía sobre otro atleta DENIEGA', () => {
    expect(decide({
      capability: 'chat_action', accountRole: 'coach', targetAthleteId: 'ath_1',
      membership: { athleteId: 'ath_OTRO', role: 'coach' },
    }).allowed).toBe(false)
  })

  it('membresía self no habilita delegación', () => {
    expect(decide({
      capability: 'chat_action', accountRole: 'coach', targetAthleteId: 'ath_1',
      membership: { athleteId: 'ath_1', role: 'self' },
    }).allowed).toBe(false)
  })

  it('rol athlete no delega ni con membresía coach', () => {
    expect(decide({
      capability: 'chat_action', accountRole: 'athlete', targetAthleteId: 'ath_1',
      membership: { athleteId: 'ath_1', role: 'coach' },
    }).allowed).toBe(false)
  })
})

describe('roleGate on — rol unknown', () => {
  it('deniega TODO, incluidas las clases de tier free', () => {
    for (const capability of ['chat_general', 'import_extract'] as const) {
      expect(decide({ capability, accountRole: 'unknown' }).allowed).toBe(false)
    }
  })
})

describe('roleGate on — coach_assistant_message', () => {
  it('exige rol coach y deja de exigir tier', () => {
    expect(decide({ capability: 'coach_assistant_message', accountRole: 'athlete', entitlement: ADVANCED }).allowed).toBe(false)
    expect(decide({ capability: 'coach_assistant_message', accountRole: 'coach', entitlement: FREE }).allowed).toBe(true)
  })

  it('un coach Free tiene cuota resoluble', () => {
    const d = decide({ capability: 'coach_assistant_message', accountRole: 'coach', entitlement: FREE })
    expect(d.quotaBucketId).toBe('coach_assistant')
    expect(d.limit).toBe(20)
  })
})
