import { describe, expect, it } from 'vitest'
import { QUOTA_BUCKETS, bucketForClass, bucketLimitForTier } from '../quotaBuckets'
import type { AIRequestClass } from '../../../types'
import { ALL_AI_REQUEST_CLASSES } from '../../ai/aiRequestClasses'
import { isClassAllowed, type Tier } from '../entitlementPolicy'

const ALL_CLASSES = Object.keys(ALL_AI_REQUEST_CLASSES) as AIRequestClass[]
const ALL_TIERS: Tier[] = ['free', 'weekly', 'advanced']

describe('cobertura de buckets', () => {
  it('toda AIRequestClass pertenece a exactamente un bucket', () => {
    for (const requestClass of ALL_CLASSES) {
      expect(QUOTA_BUCKETS.filter((b) => b.classes.includes(requestClass))).toHaveLength(1)
    }
  })

  it('cada capability permitida tiene un bucket con límite positivo para su tier', () => {
    for (const tier of ALL_TIERS) {
      for (const requestClass of ALL_CLASSES) {
        if (!isClassAllowed(tier, requestClass)) continue

        const bucket = bucketForClass(requestClass)
        expect(bucket, `${tier}/${requestClass} debe tener bucket`).not.toBeNull()
        if (!bucket) continue

        const limit = bucketLimitForTier(bucket, tier)
        expect(limit, `${tier}/${requestClass} debe tener límite`).not.toBeNull()
        if (limit == null) continue

        expect(limit, `${tier}/${requestClass} debe tener límite positivo`).toBeGreaterThan(0)
      }
    }
  })
})

describe('bucket de chat compartido', () => {
  it('chat_general y chat_action comparten bucket', () => {
    expect(bucketForClass('chat_general')).toBe(bucketForClass('chat_action'))
  })

  it('free conserva 15 en el bucket por chat_general, aunque no pueda chat_action', () => {
    expect(bucketLimitForTier(bucketForClass('chat_general')!, 'free')).toBe(15)
  })

  it('weekly baja a 40 y advanced conserva 120', () => {
    expect(bucketLimitForTier(bucketForClass('chat_general')!, 'weekly')).toBe(40)
    expect(bucketLimitForTier(bucketForClass('chat_general')!, 'advanced')).toBe(120)
  })
})

describe('import_extract', () => {
  it('tiene bucket propio con 3/dia en free', () => {
    const bucket = bucketForClass('import_extract')!
    expect(bucket.classes).toEqual(['import_extract'])
    expect(bucketLimitForTier(bucket, 'free')).toBe(3)
    expect(bucketLimitForTier(bucket, 'advanced')).toBe(10)
  })
})

describe('coach_assistant_message', () => {
  it('tiene bucket propio disponible sólo para advanced con 20/día', () => {
    const bucket = bucketForClass('coach_assistant_message')!
    expect(bucket.id).toBe('coach_assistant')
    expect(bucket.classes).toEqual(['coach_assistant_message'])
    expect(bucketLimitForTier(bucket, 'free')).toBeNull()
    expect(bucketLimitForTier(bucket, 'weekly')).toBeNull()
    expect(bucketLimitForTier(bucket, 'advanced')).toBe(20)
  })
})

describe('clases bloqueadas NO se representan como cuota 0', () => {
  it('devuelve null, no 0, para una clase que el tier no puede usar', () => {
    expect(bucketLimitForTier(bucketForClass('week_creator')!, 'free')).toBeNull()
    expect(bucketLimitForTier(bucketForClass('plan_builder_week')!, 'free')).toBeNull()
    expect(bucketLimitForTier(bucketForClass('plan_builder_week')!, 'weekly')).toBeNull()
  })

  it('plan_builder_week y plan_builder_pair tienen contadores independientes', () => {
    expect(bucketForClass('plan_builder_week')).not.toBe(bucketForClass('plan_builder_pair'))
    expect(bucketLimitForTier(bucketForClass('plan_builder_week')!, 'advanced')).toBe(16)
    expect(bucketLimitForTier(bucketForClass('plan_builder_pair')!, 'advanced')).toBe(8)
  })
})

describe('cuotas de Plan Builder llevan holgura de retry', () => {
  // MAX_WEEK_ATTEMPTS = 2, así que un plan de 12 semanas puede necesitar hasta
  // 24 intentos. 16/8 no cubre el peor caso teórico y sí el realista: dos
  // corridas de 42 semanas reportaron cero reintentos (spec §7 (b)).
  it('plan_builder_week tolera cuatro retries sobre un plan de 12 semanas', () => {
    expect(bucketLimitForTier(bucketForClass('plan_builder_week')!, 'advanced')).toBe(16)
  })

  it('plan_builder_pair tolera dos retries sobre seis pares', () => {
    expect(bucketLimitForTier(bucketForClass('plan_builder_pair')!, 'advanced')).toBe(8)
  })
})

describe('week_creator es la capacidad central de Coach Semanal', () => {
  it('weekly puede generar semanas, free no', () => {
    const bucket = bucketForClass('week_creator')!
    expect(bucketLimitForTier(bucket, 'free')).toBeNull()
    expect(bucketLimitForTier(bucket, 'weekly')).toBe(3)
    expect(bucketLimitForTier(bucket, 'advanced')).toBe(8)
  })
})

describe('bucketLimitForTier no depende del orden de bucket.classes', () => {
  it('un tier que puede usar alguna clase del bucket recibe su límite', () => {
    // Bucket sintético con la clase MENOS privilegiada en segunda posición.
    // Con el predicado posicional esto devuelve null y el test falla.
    const bucket = {
      id: 'sintetico',
      classes: ['week_creator', 'chat_general'],
      limits: { free: 7, weekly: 7, advanced: 7 },
    } as const

    expect(bucketLimitForTier(bucket, 'free')).toBe(7)
  })

  it('un tier que no puede usar ninguna clase del bucket recibe null', () => {
    const bucket = {
      id: 'sintetico-advanced',
      classes: ['plan_builder_week', 'plan_builder_pair'],
      limits: { free: 7, weekly: 7, advanced: 7 },
    } as const

    expect(bucketLimitForTier(bucket, 'free')).toBeNull()
    expect(bucketLimitForTier(bucket, 'weekly')).toBeNull()
    expect(bucketLimitForTier(bucket, 'advanced')).toBe(7)
  })
})
