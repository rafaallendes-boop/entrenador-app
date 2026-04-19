import { describe, expect, it } from 'vitest'

import { inferCoachActionIntent, shouldRetry } from '../ai/CoachEngine'
import type { CoachNormalizedResponse } from '../ai/types'

function makeResponse(overrides: Partial<CoachNormalizedResponse> = {}): CoachNormalizedResponse {
  return {
    message: overrides.message ?? 'Respuesta del coach',
    provider: overrides.provider ?? 'mock',
    traceId: overrides.traceId ?? 'test-trace',
    requestClass: overrides.requestClass ?? 'chat_general',
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  }
}

describe('CoachEngine recovery heuristics', () => {
  it('detects create_week intent from common plan-generation prompts', () => {
    expect(inferCoachActionIntent('Creame una semana para la proxima semana')).toBe('create_week')
    expect(inferCoachActionIntent('Hazme el plan de entrenamiento')).toBe('create_week')
  })

  it('detects modify intent from week-adjustment prompts', () => {
    expect(inferCoachActionIntent('Ajusta mi semana y baja la carga')).toBe('modify_plan')
    expect(inferCoachActionIntent('Reordena las sesiones de running y fuerza')).toBe('modify_plan')
  })

  it('retries when a plan was requested but the model returned prose only', () => {
    const response = makeResponse({
      message: 'Aqui tienes una propuesta general.',
      actions: undefined,
      meta: {
        hadActionsMarkup: false,
        actionParseFailed: false,
        likelyTruncated: false,
      },
    })

    expect(shouldRetry(response, 'create_week')).toBe(true)
  })

  it('does not retry when no action was requested and no parse failure happened', () => {
    const response = makeResponse({
      message: 'Duerme mejor y mantente hidratado.',
      actions: undefined,
      meta: {
        hadActionsMarkup: false,
        actionParseFailed: false,
        likelyTruncated: false,
      },
    })

    expect(shouldRetry(response, 'none')).toBe(false)
  })

  it('retries when a plan response looks truncated even if actions markup is present', () => {
    const response = makeResponse({
      message: 'Semana propuesta.',
      actions: undefined,
      meta: {
        hadActionsMarkup: true,
        actionParseFailed: true,
        likelyTruncated: true,
      },
    })

    expect(shouldRetry(response, 'create_week')).toBe(true)
  })
})
