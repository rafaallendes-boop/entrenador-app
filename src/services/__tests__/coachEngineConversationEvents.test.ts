import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIProvider } from '../ai/types'

const mocks = vi.hoisted(() => ({ text: '' }))
const provider: AIProvider = {
  name: 'mock',
  call: async (request) => ({ text: mocks.text, provider: 'mock', requestClass: request.requestClass, traceId: request.traceId }),
}
vi.mock('../ai/providerResolver', () => ({
  getProviderForRequestClass: () => provider,
  getActiveProvider: () => provider,
  isRealProviderConfigured: () => false,
}))
vi.mock('../ai/aiTelemetry', () => ({
  assertDailyAIRequestLimit: vi.fn(async () => undefined),
  recordCoachFeedback: vi.fn(),
  upsertAIRequestLog: vi.fn(async () => undefined),
}))
vi.mock('../athlete/activeAthlete', () => ({ getActiveAthleteId: () => 'ath_a', getSelfAthleteId: () => 'ath_a', getSwitchEpoch: () => 0, ATHLETE_PROFILE_LOCAL_ID: 'default' }))

import { CoachEngine } from '../ai/CoachEngine'

describe('A4.3 — sendAction con eventos conversacionales', () => {
  beforeEach(() => { mocks.text = '' })

  it('una aclaración estructurada llega sin error, sin acciones y sin reintento', async () => {
    mocks.text = '¿Qué sesión quieres mover?\n<actions>[{"type":"ask_clarification","operation":"move_session","missing":["sessionId"],"known":{"targetDate":"2026-09-18"},"summary":"Mover una sesión al viernes"}]</actions>'
    const response = await CoachEngine.sendAction('muévela al viernes', { recentSessions: [], plannedSessions: [], historicalSessions: [] })
    expect(response.actions).toBeUndefined()
    expect(response.conversationEvents?.[0]).toMatchObject({ kind: 'ask_clarification', operation: 'move_session' })
    expect(response.retryUsed).not.toBe(true)
    expect(response.message).toBe('¿Qué sesión quieres mover?')
  })

  it('una respuesta sin acciones ni eventos sigue rechazándose', async () => {
    mocks.text = 'Claro, te cuento cómo hacerlo.'
    await expect(CoachEngine.sendAction('muévela al viernes', { recentSessions: [], plannedSessions: [], historicalSessions: [] }))
      .rejects.toThrow('No pude crear una propuesta aplicable')
  })
})
