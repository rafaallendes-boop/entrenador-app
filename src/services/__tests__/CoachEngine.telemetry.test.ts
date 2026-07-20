import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockProviderCall = vi.hoisted(() => vi.fn())

vi.mock('../ai/providerResolver', () => ({
  getActiveProvider: () => ({ name: 'mock', call: mockProviderCall }),
  getProviderForRequestClass: () => ({ name: 'mock', call: mockProviderCall }),
  isRealProviderConfigured: () => true,
}))

vi.mock('../ai/aiTelemetry', () => ({
  assertDailyAIRequestLimit: vi.fn(async () => undefined),
  upsertAIRequestLog: vi.fn(async () => undefined),
}))

import { CoachEngine } from '../ai/CoachEngine'
import { useAIDebugStore } from '../../store/useAIDebugStore'

describe('CoachEngine telemetry persistence', () => {
  beforeEach(() => {
    mockProviderCall.mockReset()
    useAIDebugStore.getState().clear()
  })

  it('persists usage and server timings returned by a streaming-capable request', async () => {
    mockProviderCall.mockImplementation(async (request: { traceId: string; requestClass: string }) => ({
      text: 'Respuesta final',
      provider: 'openai',
      model: 'gpt-5-mini',
      traceId: request.traceId,
      requestClass: request.requestClass,
      durationMs: 4_100,
      finishReason: 'stop',
      promptTokens: 800,
      completionTokens: 120,
      reasoningTokens: 40,
      cacheReadInputTokens: 200,
      serviceTier: 'priority',
      reasoningEffort: 'none',
      serverDurationMs: 4_250,
      authDurationMs: 75,
    }))

    const response = await CoachEngine.sendChat(
      '¿Cómo ajusto la carga esta semana?',
      { recentMessages: [], recentSessions: [], plannedSessions: [], historicalSessions: [] },
      { onChunk: vi.fn() },
    )

    const request = useAIDebugStore.getState().requests.find((item) => item.traceId === response.traceId)
    expect(request).toMatchObject({
      status: 'completed',
      provider: 'openai',
      model: 'gpt-5-mini',
      durationMs: 4_100,
      finishReason: 'stop',
      promptTokens: 800,
      completionTokens: 120,
      reasoningTokens: 40,
      cacheReadInputTokens: 200,
      serviceTier: 'priority',
      reasoningEffort: 'none',
      serverDurationMs: 4_250,
      authDurationMs: 75,
    })
  })
})
