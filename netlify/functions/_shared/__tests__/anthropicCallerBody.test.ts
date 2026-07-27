import { describe, expect, it } from 'vitest'

import type { AIRequest } from '../../../../src/services/ai/types'
import { buildClaudeBody } from '../anthropicCaller'
import {
  resolveEffectivePlanBuilderConfig,
  resolvePlanBuilderRequestDirectives,
} from '../planBuilderRunConfig'

const request = {
  systemPrompt: 'system',
  userMessage: 'user',
  maxTokens: 5000,
  temperature: 0.25,
  requestClass: 'plan_builder_week',
} as unknown as AIRequest

describe('buildClaudeBody', () => {
  it('omits both keys when there are no directives', () => {
    const body = buildClaudeBody(request, 'claude-sonnet-4-6', { effort: null, thinking: null })
    expect(body.output_config).toBeUndefined()
    expect(body.thinking).toBeUndefined()
    // El resto del body no cambia.
    expect(body.model).toBe('claude-sonnet-4-6')
    expect(body.max_tokens).toBe(5000)
    expect(body.temperature).toBe(0.25)
  })

  it('sends effort inside output_config, not at the top level', () => {
    const body = buildClaudeBody(request, 'claude-sonnet-4-6', { effort: 'medium', thinking: null })
    expect(body.output_config).toEqual({ effort: 'medium' })
    expect(body.effort).toBeUndefined()
  })

  it('sends thinking as a typed object', () => {
    const body = buildClaudeBody(request, 'claude-sonnet-4-6', { effort: null, thinking: 'disabled' })
    expect(body.thinking).toEqual({ type: 'disabled' })
  })
})

/**
 * La invariante de la Fase 0: si el descriptor dice `effort=medium`, la request
 * mandó medium. Es la única defensa contra una ventana experimental que mide
 * una cosa y reporta otra — el modo de falla que ya mordió con `serviceTier`.
 */
describe('descriptor ↔ body agreement', () => {
  const environments = [
    {},
    { PLAN_BUILDER_EFFORT: 'high', PLAN_BUILDER_THINKING: 'disabled' },
    { PLAN_BUILDER_EFFORT: 'medium', PLAN_BUILDER_THINKING: 'disabled' },
    { PLAN_BUILDER_EFFORT: 'low', PLAN_BUILDER_THINKING: 'disabled' },
    { PLAN_BUILDER_EFFORT: 'max' },
    { PLAN_BUILDER_THINKING: 'disabled' },
  ]

  it.each(environments)('agrees for %o', (env) => {
    const descriptor = resolveEffectivePlanBuilderConfig(env as never)
    const directives = resolvePlanBuilderRequestDirectives(env as never)
    const body = buildClaudeBody(request, descriptor.model as string, directives)

    if (descriptor.effort === 'omitted') {
      expect(body.output_config).toBeUndefined()
    } else {
      expect(body.output_config).toEqual({ effort: descriptor.effort })
    }

    if (descriptor.thinkingMode === 'omitted') {
      expect(body.thinking).toBeUndefined()
    } else {
      expect(body.thinking).toEqual({ type: descriptor.thinkingMode })
    }
  })
})
