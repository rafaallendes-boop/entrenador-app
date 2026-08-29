import { describe, expect, it } from 'vitest'
import { QUOTA_BUCKETS, bucketForClass, bucketLimitForTier } from '../quotaBuckets'
import type { AIRequestClass } from '../../../types'
import { ALL_AI_REQUEST_CLASSES } from '../../ai/aiRequestClasses'

const ALL_CLASSES = Object.keys(ALL_AI_REQUEST_CLASSES) as AIRequestClass[]

describe('cobertura de buckets', () => {
  it('toda AIRequestClass pertenece a exactamente un bucket', () => {
    for (const requestClass of ALL_CLASSES) {
      expect(QUOTA_BUCKETS.filter((b) => b.classes.includes(requestClass))).toHaveLength(1)
    }
  })
})

describe('bucket de chat compartido', () => {
  it('chat_general y chat_action comparten bucket', () => {
    expect(bucketForClass('chat_general')).toBe(bucketForClass('chat_action'))
  })

  it('free tiene 15 compartidos, no 15 + 10', () => {
    expect(bucketLimitForTier(bucketForClass('chat_general')!, 'free')).toBe(15)
  })

  it('los tiers pagados conservan la capacidad total previa (80 + 40)', () => {
    expect(bucketLimitForTier(bucketForClass('chat_general')!, 'weekly')).toBe(120)
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
    expect(bucketLimitForTier(bucketForClass('plan_builder_week')!, 'advanced')).toBe(12)
    expect(bucketLimitForTier(bucketForClass('plan_builder_pair')!, 'advanced')).toBe(6)
  })
})
