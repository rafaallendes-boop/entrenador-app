// Mismo andamiaje que useChatStoreRequestScope.test.ts, pero el router
// (`../../services/chatRouting`) se deja REAL: acá se prueba la intención.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../types'

const mocks = vi.hoisted(() => ({
  athleteId: 'ath_a' as string | null,
  epoch: 1,
  chatMessages: [] as ChatMessage[],
  addProposal: vi.fn(),
  sendAction: vi.fn(),
  sendChat: vi.fn(),
  sendWeekCreate: vi.fn(),
}))

vi.mock('../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: () => mocks.athleteId,
  getSelfAthleteId: () => 'ath_a',
  getSwitchEpoch: () => mocks.epoch,
  ATHLETE_PROFILE_LOCAL_ID: 'default',
}))
vi.mock('../../db/db', () => ({
  db: {
    chatMessages: {
      add: vi.fn(async (m: ChatMessage) => { mocks.chatMessages.push(m) }),
      update: vi.fn(async () => undefined),
      // Borrado real por id: los tests de "se deshace todo" verifican que el
      // artefacto tardío desaparece, no sólo que se llamó a `delete`.
      delete: vi.fn(async (id: string) => {
        const index = mocks.chatMessages.findIndex(m => m.id === id)
        if (index >= 0) mocks.chatMessages.splice(index, 1)
      }),
      put: vi.fn(async () => undefined),
    },
    coachProposals: { delete: vi.fn(async () => undefined) },
  },
}))
vi.mock('../../services/syncService', () => ({
  pushChatMessage: vi.fn(), deleteChatMessages: vi.fn(), deleteCoachProposals: vi.fn(), pushCoachProposal: vi.fn(),
}))
vi.mock('../../services/ai/CoachEngine', () => ({
  CoachEngine: {
    sendChat: (...args: unknown[]) => mocks.sendChat(...args),
    sendAction: (...args: unknown[]) => mocks.sendAction(...args),
    send: vi.fn(),
  },
}))
vi.mock('../../services/weekCreator/WeekCreatorEngine', () => ({
  WeekCreatorEngine: { sendWeekCreate: (...args: unknown[]) => mocks.sendWeekCreate(...args) },
}))
vi.mock('../../services/ai/contextOptimizer', () => ({ optimizeChatContext: (c: unknown) => c }))
vi.mock('../useCoachActionsStore', () => ({
  useCoachActionsStore: { getState: () => ({ addProposal: mocks.addProposal, loadProposals: vi.fn() }) },
}))
vi.mock('../useAIDebugStore', () => ({
  useAIDebugStore: { getState: () => ({ completeRequest: vi.fn(), failRequest: vi.fn(), updateRequest: vi.fn(), markFirstChunk: vi.fn() }) },
}))
vi.mock('../useEntitlementStore', () => ({ getEntitlementTier: () => 'advanced' }))
vi.mock('../../utils/chatSession', () => ({
  getOrCreateChatSessionId: () => 'session-1', isLocalOnlyChatSessionId: () => false, setStoredChatSessionId: vi.fn(),
}))

import { useChatStore } from '../useChatStore'

describe('A4.4 — intención pendiente en el store', () => {
  beforeEach(() => {
    // useChatStore usa window.setTimeout/clearTimeout; este archivo corre en
    // el entorno 'node' por defecto de vitest (sin jsdom), igual que
    // useChatStore.test.ts, que aplica el mismo polyfill.
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: globalThis,
    })
    mocks.athleteId = 'ath_a'; mocks.epoch = 1; mocks.chatMessages.length = 0
    mocks.sendChat.mockReset(); mocks.sendWeekCreate.mockReset()
    mocks.sendAction.mockReset(); mocks.addProposal.mockReset()
    useChatStore.setState({ messages: [], isLoading: false, currentSessionId: 'session-1', pendingIntent: null })
  })

  it('una oferta estructurada deja una intención abierta y "dale" la consume hacia week_creator', async () => {
    mocks.sendChat.mockResolvedValue({
      message: 'Puedo armarte la semana.', provider: 'mock', traceId: 't', requestClass: 'chat_general', timestamp: 0,
      conversationEvents: [{ kind: 'offer_generation', route: 'week_creator', targetWeekStart: '2026-09-14', summary: 'Armar la semana' }],
      meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false },
    })
    // Mensaje puramente conversacional: el router real (sin mock en este
    // archivo) lo clasifica como chat_general — confirmado por el corpus
    // `general-1` — así que el motor que responde es `sendChat`.
    await useChatStore.getState().sendMessage('cómo va mi semana')
    expect(useChatStore.getState().pendingIntent).toMatchObject({ status: 'open', route: 'week_creator' })

    mocks.sendWeekCreate.mockResolvedValue({ message: 'Semana lista', provider: 'mock', traceId: 't2', requestClass: 'week_creator', timestamp: 0, actions: [], meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false } })
    const result = await useChatStore.getState().sendMessage('dale')
    expect(result.route).toBe('week_creator')
    expect(mocks.sendWeekCreate.mock.calls[0][2]).toMatchObject({ targetWeekStart: '2026-09-14' })
    expect(useChatStore.getState().pendingIntent?.status).toBe('consumed')
  })

  it('un segundo "sí" no vuelve a generar', async () => {
    useChatStore.setState({ pendingIntent: {
      id: 'i1', kind: 'generation_offer', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'consumed', route: 'week_creator', operation: { type: 'create_week', targetWeekStart: '2026-09-14' }, summary: 'Armar la semana',
    } })
    await useChatStore.getState().sendMessage('sí')
    expect(mocks.sendWeekCreate).not.toHaveBeenCalled()
    expect(mocks.sendChat).not.toHaveBeenCalled()
    expect(mocks.chatMessages.at(-1)?.content).toContain('ya quedó en marcha')
  })

  it('persiste ambos mensajes de una aclaración local', async () => {
    useChatStore.setState({ pendingIntent: {
      id: 'local', kind: 'clarification', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'open', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18' }, missing: ['sessionId'] }, summary: 'Mover',
    } })
    await useChatStore.getState().sendMessage('sí')
    expect(mocks.chatMessages.map(m => m.role)).toEqual(['user', 'coach'])
    expect(mocks.chatMessages[0].content).toBe('sí')
    expect(useChatStore.getState().isLoading).toBe(false)
  })

  it('un envío ocupado o caduco no modifica la intención ni crea respuestas locales', async () => {
    const intent = {
      id: 'local', kind: 'clarification' as const, athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'open' as const, route: 'chat_action' as const, operation: { type: 'move_session' as const, known: {}, missing: ['sessionId'] }, summary: 'Mover',
    }
    useChatStore.setState({ pendingIntent: intent, isLoading: true })
    await useChatStore.getState().sendMessage('no')
    expect(useChatStore.getState().pendingIntent).toEqual(intent)
    useChatStore.setState({ isLoading: false })
    const result = await useChatStore.getState().sendMessage('no', undefined, { athleteId: 'ath_a', epoch: 0, requestId: 'old' })
    expect(result.droppedForScopeChange).toBe(true)
    expect(useChatStore.getState().pendingIntent).toEqual(intent)
    expect(mocks.chatMessages).toEqual([])
  })

  it('una pregunta nueva pasa al coach y se persiste durante una aclaración abierta', async () => {
    useChatStore.setState({ pendingIntent: {
      id: 'local', kind: 'clarification', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'open', route: 'chat_action', operation: { type: 'move_session', known: {}, missing: ['sessionId'] }, summary: 'Mover',
    } })
    mocks.sendChat.mockResolvedValue({ message: 'Prioriza el descanso.', provider: 'mock', traceId: 'new', requestClass: 'chat_general', timestamp: 0 })
    await useChatStore.getState().sendMessage('cuanto deberia dormir esta semana')
    expect(mocks.sendChat).toHaveBeenCalledOnce()
    expect(mocks.chatMessages[0].content).toBe('cuanto deberia dormir esta semana')
  })

  it('una aclaración completada con "la del lunes" crea la propuesta sin llamar a la IA y no la aplica', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T12:00:00'))
    useChatStore.setState({ pendingIntent: {
      id: 'i2', kind: 'clarification', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'open', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18' }, missing: ['sessionId'] }, summary: 'Mover una sesión al viernes',
    } })
    mocks.addProposal.mockResolvedValue({ id: 'p1' })
    const context = { recentSessions: [], historicalSessions: [], plannedSessions: [
      { id: 's-mon', date: '2026-09-14', weekStartDate: '2026-09-14', timeBlock: 'AM' as const, type: 'squash' as const, status: 'planned' as const, title: 'Squash', durationMin: 60, createdAt: 0, updatedAt: 0 },
    ] }
    const result = await useChatStore.getState().sendMessage('la del lunes', context)
    expect(result.route).toBe('chat_action')
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(mocks.addProposal).toHaveBeenCalledTimes(1)
    expect(mocks.addProposal.mock.calls[0][1]).toEqual([{ type: 'move_session', sessionId: 's-mon', targetDate: '2026-09-18', reason: 'Confirmado por el atleta en el chat.' }])
    expect(useChatStore.getState().pendingIntent?.status).toBe('consumed')
    vi.useRealTimers()
  })

  it('"la del lunes" con dos sesiones ese día pide la franja y no llama a la IA', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T12:00:00'))
    useChatStore.setState({ pendingIntent: {
      id: 'i3', kind: 'clarification', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'open', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18' }, missing: ['sessionId'] }, summary: 'Mover una sesión al viernes',
    } })
    const planned = (id: string, timeBlock: 'AM' | 'PM', title: string) => ({ id, date: '2026-09-14', weekStartDate: '2026-09-14', timeBlock, type: 'squash' as const, status: 'planned' as const, title, durationMin: 60, createdAt: 0, updatedAt: 0 })
    await useChatStore.getState().sendMessage('la del lunes', { recentSessions: [], historicalSessions: [], plannedSessions: [planned('a', 'AM', 'Squash'), planned('b', 'PM', 'Fuerza')] })
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(mocks.chatMessages.at(-1)?.content).toContain('Squash (2026-09-14 AM), Fuerza (2026-09-14 PM)')
    expect(useChatStore.getState().pendingIntent?.status).toBe('open')
    vi.useRealTimers()
  })

  it('una operación update_session ya completa viaja al contexto de la IA como pendingOperation', async () => {
    // update_session/add_session no son deterministas (contenido no trivial):
    // buildDeterministicActionFromOperation devuelve null para ellas y la
    // operación resuelta debe llegar intacta al contexto que ve el modelo.
    useChatStore.setState({ pendingIntent: {
      id: 'i-upd', kind: 'clarification', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'open', route: 'chat_action',
      operation: { type: 'update_session', known: { sessionId: 's1', newDurationMin: 30 }, missing: [] },
      summary: 'Acortar la sesión',
    } })
    mocks.sendAction.mockResolvedValue({
      message: 'Listo, la acorté.', provider: 'mock', traceId: 't3', requestClass: 'chat_action', timestamp: 0,
      actions: [{ type: 'update_session', sessionId: 's1', newDurationMin: 30, reason: 'Confirmado por el atleta en el chat.' }],
      meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false },
    })
    mocks.addProposal.mockResolvedValue({ id: 'p-upd' })
    const result = await useChatStore.getState().sendMessage('sí')
    expect(result.route).toBe('chat_action')
    expect(mocks.sendAction).toHaveBeenCalledTimes(1)
    const [, contextArg] = mocks.sendAction.mock.calls[0] as [string, { pendingOperation?: unknown }]
    expect(contextArg.pendingOperation).toEqual({ type: 'update_session', known: { sessionId: 's1', newDurationMin: 30 }, missing: [] })
    expect(useChatStore.getState().pendingIntent?.status).toBe('consumed')
  })

  it('conversación en dos turnos: "la del lunes" guarda candidatos y "PM" crea la propuesta', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T12:00:00'))
    useChatStore.setState({ pendingIntent: {
      id: 'i4', kind: 'clarification', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'open', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18' }, missing: ['sessionId'] }, summary: 'Mover una sesión al viernes',
    } })
    mocks.addProposal.mockResolvedValue({ id: 'p2' })
    const planned = (id: string, timeBlock: 'AM' | 'PM', title: string) => ({ id, date: '2026-09-14', weekStartDate: '2026-09-14', timeBlock, type: 'squash' as const, status: 'planned' as const, title, durationMin: 60, createdAt: 0, updatedAt: 0 })
    const context = { recentSessions: [], historicalSessions: [], plannedSessions: [planned('a', 'AM', 'Squash'), planned('b', 'PM', 'Fuerza')] }
    await useChatStore.getState().sendMessage('la del lunes', context)
    expect(useChatStore.getState().pendingIntent?.operation).toMatchObject({ candidates: [{ id: 'a' }, { id: 'b' }] })
    await useChatStore.getState().sendMessage('PM', context)
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(mocks.addProposal.mock.calls[0][1]).toEqual([{ type: 'move_session', sessionId: 'b', targetDate: '2026-09-18', reason: 'Confirmado por el atleta en el chat.' }])
    expect(useChatStore.getState().pendingIntent?.status).toBe('consumed')
    vi.useRealTimers()
  })

  it('si el atleta cambia mientras se crea la propuesta determinista, se deshace todo', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T12:00:00'))
    useChatStore.setState({ pendingIntent: {
      id: 'i5', kind: 'clarification', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'open', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18', sessionId: 's-mon' }, missing: [] }, summary: 'Mover',
    } })
    mocks.addProposal.mockImplementation(async () => { mocks.athleteId = 'ath_b'; mocks.epoch = 2; return { id: 'p3' } })
    const result = await useChatStore.getState().sendMessage('sí', undefined)
    expect(result.droppedForScopeChange).toBe(true)
    expect(mocks.chatMessages.filter(m => m.role === 'coach')).toHaveLength(0)
    // discardLateCoachArtifacts borra la propuesta recién creada.
    expect(useChatStore.getState().isLoading).toBe(false)
    vi.useRealTimers()
  })

  it('una respuesta local no se publica si el hilo cambió durante la escritura', async () => {
    useChatStore.setState({ pendingIntent: {
      id: 'i6', kind: 'generation_offer', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'consumed', route: 'week_creator', operation: { type: 'create_week' }, summary: 'Semana',
    } })
    const originalAdd = (await import('../../db/db')).db.chatMessages.add as ReturnType<typeof vi.fn>
    originalAdd.mockImplementationOnce(async (m: ChatMessage) => { mocks.chatMessages.push(m); useChatStore.setState({ currentSessionId: 'session-2' }) })
    await useChatStore.getState().sendMessage('sí', undefined)
    expect(useChatStore.getState().messages.some(m => m.content.includes('ya quedó en marcha'))).toBe(false)
  })

  it('el cambio de atleta borra la intención', () => {
    useChatStore.setState({ pendingIntent: { id: 'i1', kind: 'generation_offer', athleteId: 'ath_a', conversationId: 'session-1', createdAt: 0, expiresAt: 1, status: 'open', route: 'week_creator', operation: { type: 'create_week' }, summary: 'x' } })
    useChatStore.getState().resetForAthleteSwitch()
    expect(useChatStore.getState().pendingIntent).toBeNull()
  })
})
