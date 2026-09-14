import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext, Session } from '../../types'
import type { AIProvider } from '../ai/types'

const mocks = vi.hoisted(() => ({ text: '', systemPrompt: '' }))
const provider: AIProvider = {
  name: 'mock',
  call: async (request) => {
    mocks.systemPrompt = request.systemPrompt
    return { text: mocks.text, provider: 'mock', requestClass: request.requestClass, traceId: request.traceId }
  },
}
vi.mock('../ai/providerResolver', () => ({ getProviderForRequestClass: () => provider, getActiveProvider: () => provider, isRealProviderConfigured: () => false }))
vi.mock('../ai/aiTelemetry', () => ({ assertDailyAIRequestLimit: vi.fn(async () => undefined), recordCoachFeedback: vi.fn(), upsertAIRequestLog: vi.fn(async () => undefined) }))
vi.mock('../athlete/activeAthlete', () => ({ getActiveAthleteId: () => 'ath_a', getSelfAthleteId: () => 'ath_a', getSwitchEpoch: () => 0, ATHLETE_PROFILE_LOCAL_ID: 'default' }))

import { CoachEngine } from '../ai/CoachEngine'
import { optimizeChatContext } from '../ai/contextOptimizer'

function planned(index: number): Session {
  const day = String(index + 1).padStart(2, '0')
  return {
    id: `${String(index).padStart(2, '0')}f06aaa-0000-4000-8000-${String(index).padStart(12, '0')}`,
    date: `2099-10-${day}`, weekStartDate: `2099-10-${day}`, timeBlock: 'AM', type: 'mobility', status: 'planned',
    title: `Movilidad ${index}`, durationMin: 30, createdAt: 0, updatedAt: 0,
    mobilityDetails: { focusAreas: ['hip'], context: 'full_body', targetStructure: 'circuito' },
  } as Session
}

describe('B4 — el prompt usa la proyección y el postprocesador el dominio (F06)', () => {
  beforeEach(() => { mocks.text = ''; mocks.systemPrompt = '' })

  it('una acción sobre la sesión 13 sobrevive sin que la sesión 13 viaje en el prompt', async () => {
    const sessions = Array.from({ length: 14 }, (_, i) => planned(i))
    const domain: ChatContext = { recentSessions: sessions, plannedSessions: sessions, historicalSessions: [] }
    const promptContext = optimizeChatContext(domain, 'chat_action')
    const target = sessions[12]
    mocks.text = `Listo.\n<actions>[{"type":"update_session","sessionId":"${target.id.slice(0, 8)}","newTitle":"Movilidad suave","reason":"ajuste"}]</actions>`

    const response = await CoachEngine.sendAction('cambia el título de la movilidad', domain, { promptContext })

    expect(promptContext.plannedSessions).toHaveLength(6)
    expect(mocks.systemPrompt).not.toContain(target.id.slice(0, 8))
    expect(response.actions?.[0]).toMatchObject({ type: 'update_session' })
    expect(target.id.startsWith(String(response.actions?.[0]?.sessionId))).toBe(true)
  })
})
