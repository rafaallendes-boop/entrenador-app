import { describe, expect, it } from 'vitest'

import { PRODUCTIVE_QUALITY_VERSION } from '../../../../src/services/planBuilder/qualityReview'
import { resolveEffectivePlanBuilderConfig, resolvePlanBuilderModel } from '../planBuilderRunConfig'

describe('resolvePlanBuilderModel', () => {
  it('prefers the week-specific env, then generic, then default', () => {
    expect(resolvePlanBuilderModel({ CLAUDE_MODEL_PLAN_BUILDER_WEEK: 'm-week' } as never)).toBe('m-week')
    expect(resolvePlanBuilderModel({ CLAUDE_MODEL: 'm-generic' } as never)).toBe('m-generic')
    expect(resolvePlanBuilderModel({} as never)).toBe('claude-sonnet-4-6')
  })
})

describe('resolveEffectivePlanBuilderConfig', () => {
  it('describes the request actually sent, not env vars the caller ignores', () => {
    const config = resolveEffectivePlanBuilderConfig({} as never)
    expect(config.provider).toBe('claude')
    expect(config.model).toBe('claude-sonnet-4-6')
    expect(config.effort).toBe('omitted')
    expect(config.thinkingMode).toBe('omitted')
    expect(config.temperature).toBe(0.25)
    expect(config.maxTokens).toBe(5000)
    expect(config.qualityVersion).toBe(PRODUCTIVE_QUALITY_VERSION)
    expect(config.concurrency).toBe(3) // default normalizado
  })

  it('normalises out-of-range concurrency to the worker bounds (1..6)', () => {
    expect(resolveEffectivePlanBuilderConfig({ PLAN_BUILDER_WEEK_CONCURRENCY: '10' } as never).concurrency).toBe(6)
    expect(resolveEffectivePlanBuilderConfig({ PLAN_BUILDER_WEEK_CONCURRENCY: '0' } as never).concurrency).toBe(1)
  })
})
