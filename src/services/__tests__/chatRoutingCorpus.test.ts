import { describe, expect, it } from 'vitest'
import { resolveChatRoute } from '../chatRouting'
import { CHAT_ROUTING_CORPUS } from '../chatRoutingCorpus'
import { detectChatIntent, inferRequestClassFromIntent } from '../ai/contextOptimizer'
import { mapChatRouteToRequestClass } from '../chatRouting'
import { pendingIntentFromEvents } from '../chat/pendingIntent'

describe('corpus de interpretación — engine', () => {
  for (const testCase of CHAT_ROUTING_CORPUS) {
    it(`${testCase.id}: "${testCase.message}" → ${testCase.expected}`, () => {
      const context = testCase.recentMessages
        ? { recentSessions: [], plannedSessions: [], historicalSessions: [], recentMessages: testCase.recentMessages }
        : undefined
      expect(resolveChatRoute(testCase.message, context).kind, testCase.why).toBe(testCase.expected)
    })
  }
})

describe('corpus de interpretación — proyección de la UI', () => {
  for (const testCase of CHAT_ROUTING_CORPUS) {
    it(`${testCase.id}: la clase de request de la UI coincide con la ruta esperada`, () => {
      const context = testCase.recentMessages
        ? { recentSessions: [], plannedSessions: [], historicalSessions: [], recentMessages: testCase.recentMessages }
        : undefined
      const uiClass = inferRequestClassFromIntent(detectChatIntent(testCase.message, context))
      const expectedClass = testCase.expected === 'plan_builder_redirect'
        ? 'chat_general' // la UI navega; el gate de chat_action no aplica
        : mapChatRouteToRequestClass(testCase.expected)
      expect(uiClass, testCase.why).toBe(expectedClass)
    })
  }
})

describe('corpus — intención pendiente', () => {
  const scope = { athleteId: 'ath_a', conversationId: 'conv-1' }
  const now = 5_000_000
  const offer = pendingIntentFromEvents([{ kind: 'offer_generation', route: 'week_creator', targetWeekStart: '2026-09-14', summary: 'Semana' }], scope, now)
  const askSession = pendingIntentFromEvents([{ kind: 'ask_clarification', operation: 'move_session', missing: ['sessionId'], known: { targetDate: '2026-09-18' }, summary: 'Mover' }], scope, now)
  const resolved = askSession && { ...askSession, operation: { type: 'move_session' as const, known: { targetDate: '2026-09-18', sessionId: 's1' }, missing: [] } }

  it('"dale" tras una oferta de semana → week_creator con su semana', () => {
    const route = resolveChatRoute('dale', undefined, { pendingIntent: offer, scope, now: now + 1 })
    expect(route).toMatchObject({ kind: 'week_creator', targetWeekStart: '2026-09-14', consumedIntentId: offer!.id })
  })
  it('"sí" cuando falta la sesión → se vuelve a pedir', () => {
    expect(resolveChatRoute('sí', undefined, { pendingIntent: askSession, scope, now: now + 1 })).toMatchObject({ kind: 'chat_general', pendingDecision: { kind: 'fill', missing: ['sessionId'] } })
  })
  it('"la del lunes" con una sola sesión ese día → chat_action con la operación completa', () => {
    const context = { recentSessions: [], historicalSessions: [], plannedSessions: [
      { id: 's-mon', date: '2026-09-14', weekStartDate: '2026-09-14', timeBlock: 'AM' as const, type: 'squash' as const, status: 'planned' as const, title: 'Squash', durationMin: 60, createdAt: 0, updatedAt: 0 },
    ] }
    // `now` debe caer en la semana del 14 de septiembre de 2026 para que "lunes" resuelva al 14.
    // La intención se ancla al mismo reloj: el `now` del describe (5_000_000) es
    // irrelevante para la resolución por día de la semana, pero sí para el TTL.
    const monday = new Date('2026-09-13T12:00:00').getTime()
    const intentAtMonday = askSession && { ...askSession, createdAt: monday, expiresAt: monday + 10 * 60_000 }
    const route = resolveChatRoute('la del lunes', context, { pendingIntent: intentAtMonday, scope, now: monday })
    expect(route).toMatchObject({ kind: 'chat_action', consumedIntentId: askSession!.id, pendingOperation: { type: 'move_session', known: { sessionId: 's-mon', targetDate: '2026-09-18' }, missing: [] } })
  })
  it('"muévela al viernes" con referente identificado → chat_action', () => {
    expect(resolveChatRoute('Muévela al viernes', undefined, { pendingIntent: resolved, scope, now: now + 1 }).kind).toBe('chat_action')
  })
  it('una pregunta nueva con una aclaración completa abierta NO la consume', () => {
    expect(resolveChatRoute('¿cuánto debería dormir esta semana?', undefined, { pendingIntent: resolved, scope, now: now + 1 })).toMatchObject({ kind: 'chat_general' })
    expect(resolveChatRoute('¿cuánto debería dormir esta semana?', undefined, { pendingIntent: resolved, scope, now: now + 1 }).consumedIntentId).toBeUndefined()
  })
  it('"muévela al viernes" con una intención de OTRO tipo no habilita la acción', () => {
    expect(resolveChatRoute('Muévela al viernes', undefined, { pendingIntent: offer, scope, now: now + 1 }).kind).toBe('chat_general')
  })
  it('"no, sólo explícame" cancela', () => {
    expect(resolveChatRoute('no, sólo explícame', undefined, { pendingIntent: offer, scope, now: now + 1 })).toMatchObject({ kind: 'chat_general', pendingDecision: { kind: 'cancel' } })
  })
  it('oferta consumida + otro "sí" → no se vuelve a generar', () => {
    expect(resolveChatRoute('sí', undefined, { pendingIntent: { ...offer!, status: 'consumed' }, scope, now: now + 1 })).toMatchObject({ kind: 'chat_general', pendingDecision: { kind: 'already_consumed' } })
  })
})
