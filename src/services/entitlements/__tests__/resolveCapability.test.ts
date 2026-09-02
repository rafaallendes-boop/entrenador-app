import { describe, expect, it } from 'vitest'
import { resolveCapability } from '../resolveCapability'
import type { EntitlementRow } from '../entitlementPolicy'

const NOW = Date.UTC(2026, 8, 1)
const ACTOR = 'user-actor'

function row(tier: EntitlementRow['tier'], expiresAt: number | null = null): EntitlementRow {
  return { tier, expiresAt }
}

describe('resolveCapability — decisión básica', () => {
  it('advanced puede plan_builder_week, con bucket y límite resueltos', () => {
    const decision = resolveCapability({
      actorUserId: ACTOR,
      targetAthleteId: null,
      capability: 'plan_builder_week',
      now: NOW,
      entitlement: row('advanced'),
    })

    expect(decision.allowed).toBe(true)
    expect(decision.tier).toBe('advanced')
    expect(decision.capability).toBe('plan_builder_week')
    expect(decision.requiredTier).toBe('advanced')
    expect(decision.quotaBucketId).toBe('plan_builder_week')
    expect(decision.limit).toBeGreaterThan(0)
  })

  it('free no puede plan_builder_week y su limit es null, no 0', () => {
    const decision = resolveCapability({
      actorUserId: ACTOR,
      targetAthleteId: null,
      capability: 'plan_builder_week',
      now: NOW,
      entitlement: row('free'),
    })

    expect(decision.allowed).toBe(false)
    expect(decision.limit).toBeNull()
    expect(decision.quotaBucketId).toBeNull()
    expect(decision.requiredTier).toBe('advanced')
  })

  it('un entitlement vencido resuelve a free', () => {
    const decision = resolveCapability({
      actorUserId: ACTOR,
      targetAthleteId: null,
      capability: 'week_creator',
      now: NOW,
      entitlement: row('advanced', NOW - 1),
    })

    expect(decision.tier).toBe('free')
    expect(decision.allowed).toBe(false)
  })

  it('ausencia de fila resuelve a free', () => {
    const decision = resolveCapability({
      actorUserId: ACTOR,
      targetAthleteId: null,
      capability: 'chat_general',
      now: NOW,
      entitlement: null,
    })

    expect(decision.tier).toBe('free')
    expect(decision.allowed).toBe(true)
  })
})

describe('resolveCapability — contrato de propiedad', () => {
  it('el actor es dueño del entitlement y de la cuota', () => {
    const decision = resolveCapability({
      actorUserId: ACTOR,
      targetAthleteId: 'ath_otro',
      capability: 'chat_general',
      now: NOW,
      entitlement: row('weekly'),
    })

    expect(decision.entitlementSource).toBe('self')
    expect(decision.entitlementOwnerUserId).toBe(ACTOR)
    expect(decision.quotaOwnerUserId).toBe(ACTOR)
  })

  it('consume exactamente una unidad: la cuota cuenta intentos, no producto', () => {
    for (const capability of ['chat_general', 'plan_builder_pair', 'week_creator'] as const) {
      const decision = resolveCapability({
        actorUserId: ACTOR,
        targetAthleteId: null,
        capability,
        now: NOW,
        entitlement: row('advanced'),
      })
      expect(decision.consumptionUnits).toBe(1)
    }
  })
})

describe('resolveCapability — targetAthleteId se ignora en esta versión', () => {
  it('la decisión es idéntica con y sin atleta objetivo', () => {
    const base = {
      actorUserId: ACTOR,
      capability: 'week_creator' as const,
      now: NOW,
      entitlement: row('weekly'),
    }

    expect(resolveCapability({ ...base, targetAthleteId: null }))
      .toEqual(resolveCapability({ ...base, targetAthleteId: 'ath_gestionado' }))
  })
})

describe('resolveCapability — clase desconocida', () => {
  it('se deniega incluso para advanced', () => {
    const decision = resolveCapability({
      actorUserId: ACTOR,
      targetAthleteId: null,
      // Cadena que llegó por la red y no está en la unión.
      capability: 'clase_inventada' as never,
      now: NOW,
      entitlement: row('advanced'),
    })

    expect(decision.allowed).toBe(false)
    expect(decision.requiredTier).toBeNull()
    expect(decision.limit).toBeNull()
  })
})
