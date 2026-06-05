import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveConfiguredGenerationMode,
  resolveConfiguredGenerationStrategy,
  shouldUseDeterministicPrimary,
} from '../generationState'

describe('resolveConfiguredGenerationStrategy', () => {
  const envKey = 'VITE_PLAN_BUILDER_STRATEGY'
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

  it('honors VITE_PLAN_BUILDER_STRATEGY=pairs env var', () => {
    ;(import.meta.env as Record<string, string>)[envKey] = 'pairs'
    expect(resolveConfiguredGenerationStrategy(9, undefined)).toBe('pairs')
  })

  it('treats unsupported env values as single', () => {
    ;(import.meta.env as Record<string, string>)[envKey] = 'auto'
    expect(resolveConfiguredGenerationStrategy(9, undefined)).toBe('single')
    ;(import.meta.env as Record<string, string>)[envKey] = 'bogus'
    expect(resolveConfiguredGenerationStrategy(9, undefined)).toBe('single')
  })
})

describe('resolveConfiguredGenerationMode', () => {
  const envKey = 'VITE_PLAN_BUILDER_GENERATION_MODE'
  const originalValue = (import.meta.env as Record<string, string | undefined>)[envKey]

  afterEach(() => {
    if (originalValue === undefined) {
      delete (import.meta.env as Record<string, unknown>)[envKey]
    } else {
      ;(import.meta.env as Record<string, string>)[envKey] = originalValue
    }
  })

  it('defaults to hybrid mode (AI-primary with local fallback)', () => {
    delete (import.meta.env as Record<string, unknown>)[envKey]
    expect(resolveConfiguredGenerationMode()).toBe('hybrid')
    expect(shouldUseDeterministicPrimary(resolveConfiguredGenerationMode())).toBe(false)
  })

  it('honors hybrid mode and ai alias', () => {
    ;(import.meta.env as Record<string, string>)[envKey] = 'hybrid'
    expect(resolveConfiguredGenerationMode()).toBe('hybrid')
    expect(shouldUseDeterministicPrimary(resolveConfiguredGenerationMode())).toBe(false)

    ;(import.meta.env as Record<string, string>)[envKey] = 'ai'
    expect(resolveConfiguredGenerationMode()).toBe('hybrid')
  })

  it('honors explicit deterministic opt-out', () => {
    ;(import.meta.env as Record<string, string>)[envKey] = 'deterministic'
    expect(resolveConfiguredGenerationMode()).toBe('deterministic')
    expect(shouldUseDeterministicPrimary(resolveConfiguredGenerationMode())).toBe(true)
  })

  it('treats unknown values as the hybrid default', () => {
    ;(import.meta.env as Record<string, string>)[envKey] = 'bogus'
    expect(resolveConfiguredGenerationMode()).toBe('hybrid')
  })
})
