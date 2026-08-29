import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  call: vi.fn(async () => ({
    text: '{"body":"ok"}',
    provider: 'gemini' as const,
  })),
}))

vi.mock('../providerResolver', () => ({
  getActiveProvider: () => ({ name: 'gemini' }),
  getProviderForRequestClass: () => ({ call: mocks.call, name: 'gemini' }),
  isRealProviderConfigured: () => true,
}))

vi.mock('../aiTelemetry', () => ({
  assertDailyAIRequestLimit: vi.fn(async () => undefined),
  upsertAIRequestLog: vi.fn(async () => undefined),
}))

import { CoachEngine } from '../CoachEngine'

describe('extractRaw con salida estructurada', () => {
  it('reenvía responseMimeType y responseSchema al proveedor', async () => {
    const schema = { type: 'object', properties: { body: { type: 'string' } } }
    await CoachEngine.extractRaw('sys', 'user', {
      requestClass: 'coach_assistant_message',
      surface: 'coach_assistant',
      responseMimeType: 'application/json',
      responseSchema: schema,
    })

    expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({
      requestClass: 'coach_assistant_message',
      responseMimeType: 'application/json',
      responseSchema: schema,
    }))
  })
})
