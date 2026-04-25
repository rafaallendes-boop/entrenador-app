import type { AIProvider } from './types'
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
