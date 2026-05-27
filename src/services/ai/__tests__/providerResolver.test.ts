import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getProviderForRequestClass } from '../providerResolver'

const PER_CLASS_KEYS = [
  'VITE_AI_PROVIDER_PLAN_BUILDER_WEEK',
  'VITE_AI_PROVIDER_PLAN_BUILDER_PAIR',
  'VITE_AI_PROVIDER_CHAT_GENERAL',
]
const DEFAULT_PROVIDER_KEY = 'VITE_AI_PROVIDER'

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  const env = import.meta.env as Record<string, string | undefined>
  const out: Record<string, string | undefined> = {}
  for (const key of keys) out[key] = env[key]
  return out
}

function restoreEnv(snap: Record<string, string | undefined>) {
  const env = import.meta.env as Record<string, unknown>
  for (const [key, value] of Object.entries(snap)) {
    if (value === undefined) delete env[key]
    else (env as Record<string, string>)[key] = value
  }
}

describe('getProviderForRequestClass', () => {
  const keysToManage = [...PER_CLASS_KEYS, DEFAULT_PROVIDER_KEY]
  let snap: Record<string, string | undefined>

  beforeEach(() => {
    snap = snapshotEnv(keysToManage)
    // Clear all to get deterministic baseline
    for (const k of keysToManage) delete (import.meta.env as Record<string, unknown>)[k]
  })

  afterEach(() => {
    restoreEnv(snap)
  })

  it('falls back to getActiveProvider when no override is set', () => {
    // Default VITE_AI_PROVIDER unset → getActiveProvider returns mock
    const provider = getProviderForRequestClass('plan_builder_week')
    expect(provider.name).toBe('mock')
  })

  it('honors per-requestClass env override', () => {
    ;(import.meta.env as Record<string, string>).VITE_AI_PROVIDER_PLAN_BUILDER_WEEK = 'gemini'
    const provider = getProviderForRequestClass('plan_builder_week')
    expect(provider.name).toBe('gemini')
  })

  it('per-class override on a different requestClass does NOT leak to this one', () => {
    ;(import.meta.env as Record<string, string>).VITE_AI_PROVIDER_CHAT_GENERAL = 'claude'
    ;(import.meta.env as Record<string, string>).VITE_AI_PROVIDER = 'gemini'
    const provider = getProviderForRequestClass('plan_builder_week')
    expect(provider.name).toBe('gemini') // uses default, not chat_general override
  })

  it('falls back to mock when env value is unknown', () => {
    ;(import.meta.env as Record<string, string>).VITE_AI_PROVIDER_PLAN_BUILDER_WEEK = 'bogus'
    const provider = getProviderForRequestClass('plan_builder_week')
    expect(provider.name).toBe('mock')
  })
})
