import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfiguredGenerationStrategy } from '../generationState'

describe('resolveConfiguredGenerationStrategy', () => {
  const envKey = 'VITE_PLAN_BUILDER_GENERATION_STRATEGY'
  const originalValue = (import.meta.env as Record<string, string | undefined>)[envKey]

  afterEach(() => {
    if (originalValue === undefined) {
      delete (import.meta.env as Record<string, unknown>)[envKey]
    } else {
      ;(import.meta.env as Record<string, string>)[envKey] = originalValue
    }
  })

  it('defaults to single regardless of totalWeeks when no env override and no explicit input', () => {
    delete (import.meta.env as Record<string, unknown>)[envKey]
    expect(resolveConfiguredGenerationStrategy(9, undefined)).toBe('single')
    expect(resolveConfiguredGenerationStrategy(4, undefined)).toBe('single')
    expect(resolveConfiguredGenerationStrategy(12, undefined)).toBe('single')
  })

  it('respects explicit input strategy when provided', () => {
    expect(resolveConfiguredGenerationStrategy(9, 'pairs')).toBe('pairs')
    expect(resolveConfiguredGenerationStrategy(9, 'single')).toBe('single')
  })

  it('honors VITE_PLAN_BUILDER_GENERATION_STRATEGY=pairs env var', () => {
    ;(import.meta.env as Record<string, string>)[envKey] = 'pairs'
    expect(resolveConfiguredGenerationStrategy(9, undefined)).toBe('pairs')
  })

  it('treats auto and any other env value as single', () => {
    ;(import.meta.env as Record<string, string>)[envKey] = 'auto'
    expect(resolveConfiguredGenerationStrategy(9, undefined)).toBe('single')
    ;(import.meta.env as Record<string, string>)[envKey] = 'bogus'
    expect(resolveConfiguredGenerationStrategy(9, undefined)).toBe('single')
  })
})
