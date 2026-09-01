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

const EMPTY_CONTEXT = {
  recentMessages: [], recentSessions: [], plannedSessions: [], historicalSessions: [],
}

function capturedTrace(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> | undefined {
  for (const [line] of spy.mock.calls as unknown as [string][]) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed['event'] === 'coach.request') return parsed
    } catch { /* not a trace line */ }
  }
  return undefined
}

describe('traza de etapas cuando el proveedor falla', () => {
  beforeEach(() => {
    mockProviderCall.mockReset()
    useAIDebugStore.getState().clear()
  })

  // El smoke de producción observó `outcome: parse_fail` con UNA sola etapa
  // (`prompt_build`) y sin `provider_call`, lo que impidió atribuir cuál de los
  // tres throw sites de ProxyProvider había disparado. La causa es que
  // `providerStage.end()` sólo se alcanza en el camino de éxito: una llamada
  // que lanza no deja rastro de su etapa.
  it('registra provider_call como fallida, con su mensaje de error', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    mockProviderCall.mockImplementation(async () => {
      throw new Error('El servidor devolvió un stream vacío.')
    })

    await expect(
      CoachEngine.sendChat('como voy', EMPTY_CONTEXT as never),
    ).rejects.toThrow()

    const trace = capturedTrace(spy)
    spy.mockRestore()

    expect(trace, 'debe emitirse una traza coach.request').toBeDefined()
    const stages = (trace?.['stages'] ?? []) as Array<Record<string, unknown>>
    const providerStage = stages.find((stage) => stage['stage'] === 'provider_call')

    expect(providerStage, `stages observadas: ${JSON.stringify(stages)}`).toBeDefined()
    expect(providerStage?.['ok']).toBe(false)
    expect(String(providerStage?.['error'])).toContain('stream vacío')
  })
})
