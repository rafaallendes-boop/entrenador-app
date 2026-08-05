import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockProviderCall = vi.hoisted(() => vi.fn())
const mockPostProcessCoachActions = vi.hoisted(() => vi.fn())

vi.mock('../ai/providerResolver', () => ({
  getActiveProvider: () => ({ name: 'mock', call: mockProviderCall }),
  getProviderForRequestClass: () => ({ name: 'mock', call: mockProviderCall }),
  isRealProviderConfigured: () => true,
}))

vi.mock('../ai/aiTelemetry', () => ({
  assertDailyAIRequestLimit: vi.fn(async () => undefined),
  upsertAIRequestLog: vi.fn(async () => undefined),
}))

vi.mock('../ai/actionPostProcessor', () => ({
  postProcessCoachActions: mockPostProcessCoachActions,
}))

import { CoachEngine } from '../ai/CoachEngine'
import { useAIDebugStore } from '../../store/useAIDebugStore'

describe('CoachEngine telemetry persistence', () => {
  beforeEach(() => {
    mockProviderCall.mockReset()
    mockPostProcessCoachActions.mockReset()
    mockPostProcessCoachActions.mockImplementation((result) => result)
    useAIDebugStore.getState().clear()
  })

  it('persists usage and server timings returned by a streaming-capable request', async () => {
    mockProviderCall.mockImplementation(async (request: { traceId: string; requestClass: string }) => ({
      text: 'Respuesta final',
      provider: 'openai',
      model: 'gpt-5-mini',
      streamed: true,
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
      streamed: true,
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

  it('persists the terminal transport for import extraction', async () => {
    mockProviderCall.mockImplementation(async (request: { traceId: string; requestClass: string }) => ({
      text: '{"sessions":[]}',
      provider: 'openai',
      model: 'gpt-5-mini',
      streamed: false,
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))

    await CoachEngine.extractRaw('Extrae sesiones', 'Texto importado')

    const request = useAIDebugStore.getState().requests[0]
    expect(request).toMatchObject({
      status: 'completed',
      surface: 'import',
      streamed: false,
    })
  })

  it('preserves terminal transport when action post-processing fails', async () => {
    mockProviderCall.mockImplementation(async (request: { traceId: string; requestClass: string }) => ({
      text: '<actions>[]</actions>',
      provider: 'openai',
      model: 'gpt-5-mini',
      streamed: false,
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))
    mockPostProcessCoachActions.mockImplementation(() => {
      throw new Error('post-processing failed')
    })

    await expect(CoachEngine.sendAction(
      'ajusta mi semana',
      { recentMessages: [], recentSessions: [], plannedSessions: [], historicalSessions: [] },
    )).rejects.toThrow('post-processing failed')

    expect(useAIDebugStore.getState().requests[0]).toMatchObject({
      status: 'failed',
      streamed: false,
    })
  })

  it('preserves terminal transport when normalization fails', async () => {
    mockProviderCall.mockImplementation(async (request: { traceId: string; requestClass: string }) => {
      const raw = {
        provider: 'openai',
        model: 'gpt-5-mini',
        streamed: true,
        traceId: request.traceId,
        requestClass: request.requestClass,
      }
      Object.defineProperty(raw, 'text', {
        get: () => { throw new Error('normalization failed') },
      })
      return raw
    })

    await expect(CoachEngine.sendChat(
      '¿Cómo ajusto la carga?',
      { recentMessages: [], recentSessions: [], plannedSessions: [], historicalSessions: [] },
    )).rejects.toThrow('normalization failed')

    expect(useAIDebugStore.getState().requests[0]).toMatchObject({
      status: 'failed',
      streamed: true,
    })
  })
})
