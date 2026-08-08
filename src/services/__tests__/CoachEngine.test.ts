import { describe, expect, it } from 'vitest'

import { inferCoachActionIntent } from '../ai/CoachEngine'
import {
  sendGeneralWithRecovery,
  sendWithRecovery,
  shouldRetryAction as shouldRetry,
} from '../ai/coachRecovery'
import type { AIProvider, CoachNormalizedResponse } from '../ai/types'

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

  it('retries a prose-only response on the action pipeline', () => {
    const response = makeResponse({
      message: 'Aqui tienes una propuesta general.',
      actions: undefined,
      meta: {
        hadActionsMarkup: false,
        actionParseFailed: false,
        likelyTruncated: false,
      },
    })

    expect(shouldRetry(response)).toBe(true)
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

  it('retries an action-pipeline response that omits actions', () => {
    const response = makeResponse({
      message: 'Duerme mejor y mantente hidratado.',
      actions: undefined,
      meta: {
        hadActionsMarkup: false,
        actionParseFailed: false,
        likelyTruncated: false,
      },
    })

    expect(shouldRetry(response)).toBe(true)
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

  it('fails safely when both action attempts are truncated', async () => {
    const provider: AIProvider = {
      name: 'mock',
      call: async (request) => ({
        text: 'Te preparo una sesion de fuerza.\n\n<actions>[{"type":"add_session","targetDate":"2026-05-25","timeBlock":"PM","sessionType":"strength","title":"Fuerza","durationMin":60,"exercises":[{"name":"Press Z","sets":4,"reps":3,"group"',
        provider: 'mock',
        model: 'mock',
        traceId: request.traceId,
        requestClass: request.requestClass,
      }),
    }

    await expect(sendWithRecovery(provider, {
      systemPrompt: 'Responde con acciones.',
      userMessage: 'genera una sesion de pesas para hoy',
      requestClass: 'chat_action',
      traceId: 'trace-recovery',
    })).rejects.toMatchObject({
      code: 'parse_error',
    })
  })

  it('retries prose-only action responses and keeps the recovered proposal', async () => {
    let callCount = 0
    const provider: AIProvider = {
      name: 'mock',
      call: async (request) => {
        callCount += 1
        return callCount === 1
          ? {
              text: 'He creado la sesión de fuerza para el lunes.',
              provider: 'mock',
              traceId: request.traceId,
              requestClass: request.requestClass,
            }
          : {
              text: 'Te propongo este cambio.<actions>[{"type":"add_session","reason":"Crear la sesión solicitada","targetDate":"2026-05-25","timeBlock":"PM","sessionType":"strength","title":"Fuerza con superseries","durationMin":60,"objective":"Fuerza general"}]</actions>',
              provider: 'mock',
              traceId: request.traceId,
              requestClass: request.requestClass,
            }
      },
    }

    const response = await sendWithRecovery(provider, {
      systemPrompt: 'Responde con acciones.',
      userMessage: 'créala',
      requestClass: 'chat_action',
      traceId: 'trace-prose-recovery',
    })

    expect(callCount).toBe(2)
    expect(response.retryUsed).toBe(true)
    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0]?.type).toBe('add_session')
  })

  it('returns a prose-only action response after the format retry for local repair', async () => {
    const provider: AIProvider = {
      name: 'mock',
      call: async (request) => ({
        text: 'He creado la sesión de fuerza para el lunes.',
        provider: 'mock',
        traceId: request.traceId,
        requestClass: request.requestClass,
      }),
    }

    const response = await sendWithRecovery(provider, {
      systemPrompt: 'Responde con acciones.',
      userMessage: 'créala',
      requestClass: 'chat_action',
      traceId: 'trace-prose-rejection',
    })

    expect(response.retryUsed).toBe(true)
    expect(response.actions).toBeUndefined()
  })

  it('retries a truncated general answer with a concise complete response', async () => {
    let callCount = 0
    const provider: AIProvider = {
      name: 'mock',
      call: async (request) => {
        callCount += 1
        return callCount === 1
          ? {
              text: 'Respuesta demasiado larga y cortada',
              provider: 'mock',
              traceId: request.traceId,
              requestClass: request.requestClass,
              finishReason: 'MAX_TOKENS',
            }
          : {
              text: 'Respuesta completa y concisa.',
              provider: 'mock',
              traceId: request.traceId,
              requestClass: request.requestClass,
              finishReason: 'STOP',
            }
      },
    }

    const response = await sendGeneralWithRecovery(provider, {
      systemPrompt: 'Responde como coach.',
      userMessage: 'Analiza mi semana',
      requestClass: 'chat_general',
      traceId: 'trace-general-recovery',
    })

    expect(callCount).toBe(2)
    expect(response.message).toBe('Respuesta completa y concisa.')
    expect(response.retryUsed).toBe(true)
    expect(response.meta?.likelyTruncated).toBe(false)
  })
})
