import { describe, expect, it } from 'vitest'
import {
  QUOTA_BUCKETS, bucketForClass, bucketLimitForTier,
  bucketLimitIgnoringTierGate, perSubjectLimitForTier,
} from '../quotaBuckets'
import { TIER_ORDER, type Tier } from '../entitlementPolicy'

const TIERS = Object.keys(TIER_ORDER) as Tier[]

describe('perSubjectLimitForTier', () => {
  it('null cuando el bucket no declara tope por atleta', () => {
    expect(perSubjectLimitForTier({ id: 'x', classes: ['chat_general'], limits: { free: 5 } }, 'free')).toBeNull()
  })
  it('null cuando el tier no puede usar ninguna clase del bucket', () => {
    const b = { id: 'x', classes: ['plan_builder_week'] as const, limits: { advanced: 10 }, perSubjectLimits: { advanced: 4 } }
    expect(perSubjectLimitForTier(b, 'free')).toBeNull()
  })

  it('null cuando la clase es permitida pero falta su límite global', () => {
    // `weekly` sí puede chat_general, pero este bucket está mal configurado:
    // no tiene límite global Weekly. No se puede crear un contador por atleta
    // sin su contador padre.
    const b = {
      id: 'x',
      classes: ['chat_general'] as const,
      limits: { free: 5 },
      perSubjectLimits: { weekly: 2 },
    }
    expect(perSubjectLimitForTier(b, 'weekly')).toBeNull()
  })
})

describe('coach_assistant tiene cuota en los tres tiers', () => {
  it('un coach con tier free resuelve un límite, no null', () => {
    // La clase se habilita por ROL, no por tier: si el bucket sólo declarara
    // `advanced`, un coach Free quedaría denegado por falta de cuota.
    const bucket = bucketForClass('coach_assistant_message')
    expect(bucket).not.toBeNull()
    for (const tier of TIERS) {
      expect(bucketLimitIgnoringTierGate(bucket!, tier)).toBeGreaterThan(0)
    }
  })
})

describe('invariantes de configuración', () => {
  it('todo tope por atleta es ESTRICTAMENTE menor que el global de su tier', () => {
    for (const bucket of QUOTA_BUCKETS) {
      for (const tier of TIERS) {
        const perSubject = perSubjectLimitForTier(bucket, tier)
        if (perSubject == null) continue
        const global = bucketLimitForTier(bucket, tier)
        expect(global).not.toBeNull()
        expect(perSubject).toBeGreaterThan(0)
        expect(perSubject).toBeLessThan(global as number)
      }
    }
  })
  it('ningún tope por atleta es 0: la ausencia se expresa omitiendo la clave', () => {
    for (const bucket of QUOTA_BUCKETS) {
      for (const value of Object.values(bucket.perSubjectLimits ?? {})) {
        expect(value).toBeGreaterThan(0)
      }
    }
  })
})
