import { describe, expect, it } from 'vitest'

import { PRODUCTIVE_QUALITY_VERSION } from '../../../../src/services/planBuilder/qualityReview'
import {
  resolveEffectivePlanBuilderConfig,
  resolvePlanBuilderModel,
  resolvePlanBuilderRequestDirectives,
} from '../planBuilderRunConfig'

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

describe('resolvePlanBuilderRequestDirectives', () => {
  it('does not send anything when the vars are absent', () => {
    const directives = resolvePlanBuilderRequestDirectives({} as never)
    expect(directives).toEqual({ effort: null, thinking: null })
  })

  it('treats an empty value as absent, like the concurrency resolver does', () => {
    expect(resolvePlanBuilderRequestDirectives({
      PLAN_BUILDER_EFFORT: '   ',
    } as never).effort).toBeNull()
  })

  it('applies every effort level Sonnet 4.6 accepts', () => {
    for (const effort of ['low', 'medium', 'high', 'max']) {
      expect(resolvePlanBuilderRequestDirectives({
        PLAN_BUILDER_EFFORT: effort,
      } as never).effort).toBe(effort)
    }
  })

  it('applies thinking disabled', () => {
    expect(resolvePlanBuilderRequestDirectives({
      PLAN_BUILDER_THINKING: 'disabled',
    } as never).thinking).toBe('disabled')
  })

  // Un typo convertiría una corrida pagada en otro control high sin que nadie
  // lo note: por eso es error, no fallback.
  it('throws on a typo instead of silently falling back', () => {
    expect(() => resolvePlanBuilderRequestDirectives({
      PLAN_BUILDER_EFFORT: 'mediun',
    } as never)).toThrow(/PLAN_BUILDER_EFFORT/)
  })

  it('rejects xhigh, which Sonnet 4.6 does not accept', () => {
    expect(() => resolvePlanBuilderRequestDirectives({
      PLAN_BUILDER_EFFORT: 'xhigh',
    } as never)).toThrow(/claude-sonnet-4-6/)
  })

  // adaptive queda fuera de alcance: el caller manda temperature 0.25 y esa
  // interacción no está resuelta en esta base de código.
  it('rejects adaptive thinking while it stays out of scope', () => {
    expect(() => resolvePlanBuilderRequestDirectives({
      PLAN_BUILDER_THINKING: 'adaptive',
    } as never)).toThrow(/PLAN_BUILDER_THINKING/)
  })

  it('rejects a value for a model with no allowlist entry', () => {
    expect(() => resolvePlanBuilderRequestDirectives({
      CLAUDE_MODEL_PLAN_BUILDER_WEEK: 'claude-sonnet-5',
      PLAN_BUILDER_EFFORT: 'medium',
    } as never)).toThrow(/claude-sonnet-5/)
  })

  it('validates against an explicit effective model when the caller overrides env', () => {
    expect(resolvePlanBuilderRequestDirectives({
      CLAUDE_MODEL_PLAN_BUILDER_WEEK: 'claude-haiku-4-5',
      PLAN_BUILDER_EFFORT: 'medium',
    } as never, 'claude-sonnet-4-6')).toEqual({
      effort: 'medium',
      thinking: null,
    })
  })
})

describe('resolveEffectivePlanBuilderConfig with directives', () => {
  it('reports the applied values, not omitted', () => {
    const config = resolveEffectivePlanBuilderConfig({
      PLAN_BUILDER_EFFORT: 'medium',
      PLAN_BUILDER_THINKING: 'disabled',
    } as never)
    expect(config.effort).toBe('medium')
    expect(config.thinkingMode).toBe('disabled')
  })

  it('propagates the configuration error instead of describing a variant that never ran', () => {
    expect(() => resolveEffectivePlanBuilderConfig({
      PLAN_BUILDER_EFFORT: 'xhigh',
    } as never)).toThrow()
  })
})
