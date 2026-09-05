import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TriageSignal } from '../../athlete/coachRosterTriage'
import { AIProviderError } from '../../ai/types'
import {
  EntitlementRequiredError,
  buildEntitlementDetail,
} from '../../entitlements/entitlementError'
import {
  KillSwitchActiveError,
  QuotaExceededError,
  SpendCapExceededError,
  UsageGateUnavailableError,
} from '../../entitlements/usageGateError'

const mocks = vi.hoisted(() => ({ extractRaw: vi.fn() }))

vi.mock('../../ai/CoachEngine', () => ({
  CoachEngine: { extractRaw: mocks.extractRaw },
}))

import { ASSISTANT_MESSAGE_SCHEMA, ASSISTANT_SYSTEM_PROMPT } from '../assistantMessage'
import { requestAssistantDraft } from '../requestAssistantDraft'

const SIGNALS: TriageSignal[] = [{ kind: 'pain', days: 2 }]
const ATHLETE_ID = 'ath_m_1'

describe('requestAssistantDraft', () => {
  beforeEach(() => {
    mocks.extractRaw.mockReset()
  })

  it('llama con clase, superficie y salida estructurada explícitas', async () => {
    mocks.extractRaw.mockResolvedValueOnce('{"body":"¿Cómo vas?"}')

    await requestAssistantDraft(ATHLETE_ID, SIGNALS)

    expect(mocks.extractRaw).toHaveBeenCalledWith(
      ASSISTANT_SYSTEM_PROMPT,
      expect.any(String),
      {
        requestClass: 'coach_assistant_message',
        surface: 'coach_assistant',
        targetAthleteId: ATHLETE_ID,
        responseMimeType: 'application/json',
        responseSchema: ASSISTANT_MESSAGE_SCHEMA,
        classifyResponse: expect.any(Function),
      },
    )
  })

  it('no envía identificadores, texto libre ni fechas absolutas', async () => {
    mocks.extractRaw.mockResolvedValueOnce('{"body":"ok"}')

    await requestAssistantDraft(ATHLETE_ID, SIGNALS)
    const userMessage = mocks.extractRaw.mock.calls.at(-1)?.[1] as string

    expect(JSON.parse(userMessage)).toEqual({ signals: [{ kind: 'pain', days: 2 }] })
    for (const forbidden of ['athleteId', 'painNotes', 'name', '2026-', 'date', 'id']) {
      expect(userMessage).not.toContain(forbidden)
    }
  })

  it('devuelve el cuerpo validado', async () => {
    mocks.extractRaw.mockResolvedValueOnce('{"body":"¿Cómo vas?"}')

    await expect(requestAssistantDraft(ATHLETE_ID, SIGNALS)).resolves.toEqual({
      ok: true,
      body: '¿Cómo vas?',
    })
  })

  it('descarta entera una respuesta inválida', async () => {
    mocks.extractRaw.mockResolvedValueOnce('{"body":"","advice":"baja la carga"}')

    await expect(requestAssistantDraft(ATHLETE_ID, SIGNALS)).resolves.toEqual({
      ok: false,
      reason: 'invalid-response',
    })
  })

  it('explica cuando el proveedor devuelve un borrador sobre el tope', async () => {
    mocks.extractRaw.mockResolvedValueOnce(JSON.stringify({ body: 'x'.repeat(601) }))

    await expect(requestAssistantDraft(ATHLETE_ID, SIGNALS)).resolves.toEqual({
      ok: false,
      reason: 'too-long',
    })
  })

  it('sin señales falla cerrado y no llama al proveedor', async () => {
    await expect(requestAssistantDraft(ATHLETE_ID, [])).resolves.toEqual({
      ok: false,
      reason: 'invalid-response',
    })
    expect(mocks.extractRaw).not.toHaveBeenCalled()
  })

  it.each([
    [new QuotaExceededError({ bucketId: 'coach_assistant', limit: 20, remaining: 0 }), 'quota'],
    [new SpendCapExceededError({ scope: 'account', capUsd: 1 }), 'quota'],
    [new AIProviderError('gemini', 'rate_limit', 'Límite diario alcanzado (20/20).', false), 'quota'],
    [new KillSwitchActiveError(), 'kill-switch'],
    [new EntitlementRequiredError(
      buildEntitlementDetail('coach_assistant_message', 'advanced', 'weekly'),
    ), 'entitlement'],
  ] as const)('clasifica el rechazo tipado %# como %s', async (error, reason) => {
    mocks.extractRaw.mockRejectedValueOnce(error)

    await expect(requestAssistantDraft(ATHLETE_ID, SIGNALS)).resolves.toEqual({ ok: false, reason })
  })

  it.each([
    [new AIProviderError('gemini', 'timeout', 'timeout', true), 'timeout'],
    [new AIProviderError('gemini', 'server_error', 'server', true), 'network'],
    [new AIProviderError('gemini', 'server_error', 'server', false), 'unavailable'],
    [new AIProviderError('gemini', 'rate_limit', '429 del proveedor', true), 'rate-limit'],
    [new AIProviderError('gemini', 'misconfigured', 'sin API key', false), 'unavailable'],
    [new UsageGateUnavailableError('gate caído'), 'unavailable'],
    [new AIProviderError('gemini', 'parse_error', 'JSON inválido', false), 'invalid-response'],
    [new TypeError('Failed to fetch'), 'network'],
  ] as const)('clasifica el fallo técnico %# como %s', async (error, reason) => {
    mocks.extractRaw.mockRejectedValueOnce(error)

    await expect(requestAssistantDraft(ATHLETE_ID, SIGNALS)).resolves.toEqual({ ok: false, reason })
  })

  it('clasifica AbortError como timeout', async () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    mocks.extractRaw.mockRejectedValueOnce(error)

    await expect(requestAssistantDraft(ATHLETE_ID, SIGNALS)).resolves.toEqual({
      ok: false,
      reason: 'timeout',
    })
  })
})
