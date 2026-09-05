import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockProviderCall = vi.hoisted(() => vi.fn())

vi.mock('../providerResolver', () => ({
  getActiveProvider: () => ({ name: 'mock', call: mockProviderCall }),
  getProviderForRequestClass: () => ({ name: 'mock', call: mockProviderCall }),
  isRealProviderConfigured: () => true,
}))

vi.mock('../aiTelemetry', () => ({
  assertDailyAIRequestLimit: vi.fn(async () => undefined),
  upsertAIRequestLog: vi.fn(async () => undefined),
}))

import { CoachEngine } from '../CoachEngine'
import { setActiveAthleteId, setSelfAthleteId } from '../../athlete/activeAthlete'
import type { ChatContext } from '../../../types'

const EMPTY_CONTEXT: ChatContext = {
  recentMessages: [], recentSessions: [], plannedSessions: [], historicalSessions: [],
}

function lastRequestTarget(): unknown {
  const request = mockProviderCall.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
  return request?.['targetAthleteId']
}

describe('el objetivo propuesto viaja en la request del proveedor', () => {
  beforeEach(() => {
    mockProviderCall.mockReset()
    mockProviderCall.mockImplementation(async (request: { traceId: string; requestClass: string }) => ({
      text: '{}',
      provider: 'mock',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))
  })

  afterEach(() => {
    setSelfAthleteId(null)
    setActiveAthleteId(null)
  })

  it('el chat propone el atleta gestionado activo', async () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')

    await CoachEngine.sendChat('¿Cómo voy?', EMPTY_CONTEXT)

    expect(lastRequestTarget()).toBe('ath_m_1')
  })

  it('el chat del propio atleta no propone objetivo', async () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')

    await CoachEngine.sendChat('¿Cómo voy?', EMPTY_CONTEXT)

    expect(lastRequestTarget()).toBeNull()
  })

  it('el import de PDF hereda el atleta activo sin objetivo explícito', async () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')

    await CoachEngine.extractRaw('Extrae sesiones', 'Texto importado')

    expect(lastRequestTarget()).toBe('ath_m_1')
  })

  it('un objetivo explícito gana sobre el scope activo', async () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')

    await CoachEngine.extractRaw('Sistema', 'Mensaje', { targetAthleteId: 'ath_m_2' })

    expect(lastRequestTarget()).toBe('ath_m_2')
  })
})
