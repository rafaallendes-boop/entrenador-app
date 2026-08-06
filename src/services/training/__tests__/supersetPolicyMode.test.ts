import { describe, expect, it } from 'vitest'

import { shouldApplySupersetPolicy, type SupersetIntent } from '../supersetPolicy'
import type { StrengthPhase, StrengthSportProfile } from '../strengthSelector'

const PHASES: StrengthPhase[] = ['base', 'build', 'peak', 'taper', 'transition', 'race']
const PROFILES: StrengthSportProfile[] = ['strength_primary', 'hybrid', 'sport_support']
const DURATIONS = [30, 44, 45, 54, 55, 60, 90]
const INTENTS: Array<SupersetIntent | undefined> = [undefined, 'requested', 'declined']

describe('shouldApplySupersetPolicy', () => {
  it('aplica R0 como off absoluto aun con preferencia', () => {
    expect(shouldApplySupersetPolicy({ intent: 'requested' })).toBe('off')
    expect(shouldApplySupersetPolicy({ phase: 'base', intent: 'requested' })).toBe('off')
    expect(shouldApplySupersetPolicy({
      phase: 'base',
      sportProfile: 'hybrid',
      intent: 'requested',
    })).toBe('off')
    expect(shouldApplySupersetPolicy({
      phase: 'nope' as StrengthPhase,
      sportProfile: 'hybrid',
      sessionDurationMin: 60,
      intent: 'requested',
    })).toBe('off')
    expect(shouldApplySupersetPolicy({
      phase: 'toString' as StrengthPhase,
      sportProfile: 'hybrid',
      sessionDurationMin: 60,
      intent: 'requested',
    })).toBe('off')
  })

  // El rechazo explicito es la unica señal que apaga la politica desde arriba.
  // Sin el, un contexto que resuelve `permissive` por si solo agrupaba igual
  // aunque el atleta hubiera pedido lo contrario.
  it('apaga la politica ante un rechazo explicito, en todo contexto valido', () => {
    for (const phase of PHASES) {
      for (const sportProfile of PROFILES) {
        for (const sessionDurationMin of DURATIONS) {
          expect(
            shouldApplySupersetPolicy({ phase, sportProfile, sessionDurationMin, intent: 'declined' }),
            `${phase}/${sportProfile}/${sessionDurationMin}`,
          ).toBe('off')
        }
      }
    }
  })

  it('distingue no mencionar de rechazar', () => {
    const context = {
      phase: 'base' as const,
      sportProfile: 'sport_support' as const,
      sessionDurationMin: 60,
    }

    expect(shouldApplySupersetPolicy(context)).toBe('permissive')
    expect(shouldApplySupersetPolicy({ ...context, intent: 'declined' })).toBe('off')
  })

  it('limita peak a permissive incluso con preferencia', () => {
    for (const sportProfile of PROFILES) {
      expect(shouldApplySupersetPolicy({
        phase: 'peak',
        sportProfile,
        sessionDurationMin: 90,
        intent: 'requested',
      })).toBe('permissive')
    }
  })

  it('sube taper, race y transition solo a permissive con preferencia', () => {
    for (const phase of ['taper', 'race', 'transition'] as StrengthPhase[]) {
      const context = { phase, sportProfile: 'hybrid' as const, sessionDurationMin: 60 }
      expect(shouldApplySupersetPolicy(context)).toBe('off')
      expect(shouldApplySupersetPolicy({ ...context, intent: 'requested' })).toBe('permissive')
    }
  })

  it('reserva full automatico a strength_primary base/build desde 55 min', () => {
    expect(shouldApplySupersetPolicy({
      phase: 'base', sportProfile: 'strength_primary', sessionDurationMin: 55,
    })).toBe('full')
    expect(shouldApplySupersetPolicy({
      phase: 'build', sportProfile: 'strength_primary', sessionDurationMin: 54,
    })).toBe('permissive')
    expect(shouldApplySupersetPolicy({
      phase: 'base', sportProfile: 'hybrid', sessionDurationMin: 90,
    })).toBe('permissive')
  })

  it('permite que hybrid llegue a full mediante preferencia', () => {
    expect(shouldApplySupersetPolicy({
      phase: 'base',
      sportProfile: 'hybrid',
      sessionDurationMin: 60,
      intent: 'requested',
    })).toBe('full')
  })

  it('coincide con un oracle independiente en las 378 combinaciones', () => {
    const rank = { off: 0, permissive: 1, full: 2 } as const
    const cap: Record<StrengthPhase, 'off' | 'permissive' | 'full'> = {
      base: 'full',
      build: 'full',
      peak: 'permissive',
      taper: 'permissive',
      transition: 'permissive',
      race: 'permissive',
    }
    const oracle = (
      phase: StrengthPhase,
      profile: StrengthSportProfile,
      duration: number,
      intent: SupersetIntent | undefined,
    ): 'off' | 'permissive' | 'full' => {
      if (intent === 'declined') return 'off'

      let base: 'off' | 'permissive' | 'full'
      if (phase === 'taper' || phase === 'race' || phase === 'transition') base = 'off'
      else if (duration < 45) base = 'off'
      else if (
        profile === 'strength_primary'
        && (phase === 'base' || phase === 'build')
        && duration >= 55
      ) base = 'full'
      else base = 'permissive'

      const requested = intent === 'requested'
        ? (['off', 'permissive', 'full'] as const)[Math.min(rank[base] + 1, 2)]!
        : base
      return rank[requested] <= rank[cap[phase]] ? requested : cap[phase]
    }
    let assertions = 0

    for (const phase of PHASES) {
      for (const sportProfile of PROFILES) {
        for (const sessionDurationMin of DURATIONS) {
          for (const intent of INTENTS) {
            expect(
              shouldApplySupersetPolicy({ phase, sportProfile, sessionDurationMin, intent }),
              `${phase}/${sportProfile}/${sessionDurationMin}/${intent ?? 'sin mencion'}`,
            ).toBe(oracle(phase, sportProfile, sessionDurationMin, intent))
            assertions += 1
          }
        }
      }
    }

    expect(assertions).toBe(378)
  })

  it('rechaza duraciones no positivas o no finitas', () => {
    for (const sessionDurationMin of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(shouldApplySupersetPolicy({
        phase: 'base',
        sportProfile: 'hybrid',
        sessionDurationMin,
        intent: 'requested',
      })).toBe('off')
    }
  })

  it('nunca salta mas de un nivel por preferencia', () => {
    const rank = { off: 0, permissive: 1, full: 2 } as const
    for (const phase of PHASES) {
      for (const sportProfile of PROFILES) {
        for (const sessionDurationMin of DURATIONS) {
          const context = { phase, sportProfile, sessionDurationMin }
          const base = shouldApplySupersetPolicy(context)
          const boosted = shouldApplySupersetPolicy({ ...context, intent: 'requested' })
          expect(rank[boosted] - rank[base]).toBeGreaterThanOrEqual(0)
          expect(rank[boosted] - rank[base]).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})
