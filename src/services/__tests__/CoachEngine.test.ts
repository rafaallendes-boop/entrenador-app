import { describe, expect, it } from 'vitest'

import { inferCoachActionIntent } from '../ai/CoachEngine'
import { shouldRetryAction as shouldRetry } from '../ai/coachRecovery'
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
  it('only detects explicit full-plan intents for heavy planning', () => {
    expect(inferCoachActionIntent('Creame una semana para la proxima semana')).toBe('none')
    expect(inferCoachActionIntent('Hazme el plan de entrenamiento')).toBe('none')
    expect(inferCoachActionIntent('Hazme el plan hasta el evento')).toBe('create_full_plan')
  })

  it('detects modify intent from week-adjustment prompts', () => {
    expect(inferCoachActionIntent('Ajusta mi semana y baja la carga')).toBe('modify_plan')
    expect(inferCoachActionIntent('Reordena las sesiones de running y fuerza')).toBe('modify_plan')
  })

  it('does not retry a coherent prose-only response without parse failure', () => {
    const response = makeResponse({
      message: 'Aqui tienes una propuesta general.',
      actions: undefined,
      meta: {
        hadActionsMarkup: false,
        actionParseFailed: false,
        likelyTruncated: false,
      },
    })

    expect(shouldRetry(response)).toBe(false)
  })

  it('does not require multiple create_week actions anymore after a valid action response', () => {
    const response = makeResponse({
      message: 'Semana propuesta.',
      actions: [
        {
          type: 'create_week',
          reason: 'Semana compacta',
          targetDate: '2026-05-04',
          sessions: [
            {
              date: '2026-05-04',
              timeBlock: 'AM',
              sessionType: 'running',
              title: 'Rodaje suave',
              durationMin: 45,
            },
          ],
        },
      ],
      meta: {
        hadActionsMarkup: true,
        actionParseFailed: false,
        likelyTruncated: false,
      },
    })

    expect(shouldRetry(response)).toBe(false)
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

    expect(shouldRetry(response)).toBe(false)
  })

  it('retries when a full-plan response looks truncated even if actions markup is present', () => {
    const response = makeResponse({
      message: 'Semana propuesta.',
      actions: undefined,
      meta: {
        hadActionsMarkup: true,
        actionParseFailed: true,
        likelyTruncated: true,
      },
    })

    expect(shouldRetry(response)).toBe(true)
  })
})
