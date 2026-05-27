import type { AIProvider } from './types'
import type { AIRequestClass } from '../../types'
import { ClaudeProvider } from './providers/ClaudeProvider'
import { OpenAIProvider } from './providers/OpenAIProvider'
import { MockProvider } from './providers/MockProvider'
import { GeminiProvider } from './providers/GeminiProvider'
import { ProxyProvider } from './providers/ProxyProvider'

export function getConfiguredProviderName(): string {
  if (import.meta.env.PROD) {
    return 'proxy'
  }
  return (import.meta.env.VITE_AI_PROVIDER ?? 'mock').toLowerCase()
}

export function getActiveProvider(): AIProvider {
  const name = getConfiguredProviderName()
  switch (name) {
    case 'proxy':
      return new ProxyProvider()
    case 'claude':
      return new ClaudeProvider()
    case 'openai':
      return new OpenAIProvider()
    case 'gemini':
      return new GeminiProvider()
    default:
      return new MockProvider()
  }
}

function providerFromName(name: string): AIProvider {
  switch (name.toLowerCase()) {
    case 'proxy': return new ProxyProvider()
    case 'claude': return new ClaudeProvider()
    case 'openai': return new OpenAIProvider()
    case 'gemini': return new GeminiProvider()
    case 'mock': return new MockProvider()
    default: return new MockProvider()
  }
}

/**
 * Returns a provider, optionally overridden per requestClass via env var.
 *
 * Env var convention: `VITE_AI_PROVIDER_<REQUEST_CLASS_UPPER>` (e.g.
 * `VITE_AI_PROVIDER_PLAN_BUILDER_WEEK=claude`). In PROD, overrides are ignored
 * and the function always returns the ProxyProvider via `getActiveProvider()`.
 *
 * Falls back to `getActiveProvider()` when no override is set.
 */
export function getProviderForRequestClass(requestClass: AIRequestClass): AIProvider {
  if (import.meta.env.PROD) {
    return getActiveProvider()
  }
  const envKey = `VITE_AI_PROVIDER_${requestClass.toUpperCase()}`
  const override = (import.meta.env as Record<string, string | undefined>)[envKey]
  if (!override) return getActiveProvider()
  return providerFromName(override)
}

// VITE_* API keys below are only read in local dev (PROD always uses 'proxy' above).
// NEVER set these to real keys in .env.local — they are bundled into the client JS and
// would be exposed publicly. Use them only as a truthy presence check for dev UI hints.
export function isRealProviderConfigured(): boolean {
  const name = getConfiguredProviderName()
  if (name === 'proxy') return true
  if (name === 'claude') {
    return !!(import.meta.env.VITE_CLAUDE_API_KEY ?? import.meta.env.VITE_AI_API_KEY)
  }
  if (name === 'openai') {
    return !!import.meta.env.VITE_OPENAI_API_KEY
  }
  if (name === 'gemini') {
    return !!import.meta.env.VITE_GEMINI_API_KEY
  }
  return false
}
