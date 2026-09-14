import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../types'

const mocks = vi.hoisted(() => ({
  athleteId: 'ath_a' as string | null,
  epoch: 1,
  chatMessages: [] as ChatMessage[],
  addProposal: vi.fn(),
  sendAction: vi.fn(),
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
    sendChat: vi.fn(), send: vi.fn(),
    sendAction: (...args: unknown[]) => mocks.sendAction(...args),
  },
}))
vi.mock('../../services/weekCreator/WeekCreatorEngine', () => ({ WeekCreatorEngine: { sendWeekCreate: vi.fn() } }))
vi.mock('../../services/ai/contextOptimizer', () => ({
  optimizeChatContext: (c: unknown) => c,
  selectDomainRecentMessages: (messages: { role: string; content: string; timestamp?: number }[]) =>
    messages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
}))
vi.mock('../../services/chatRouting', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    resolveChatRoute: () => ({ kind: 'chat_action' }),
  }
})
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

describe('A5 — el scope capturado gobierna la persistencia', () => {
  beforeEach(() => {
    // useChatStore usa window.setTimeout/clearTimeout; este archivo corre en
    // el entorno 'node' por defecto de vitest (sin jsdom), igual que
    // useChatStore.test.ts, que aplica el mismo polyfill.
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: globalThis,
    })
    mocks.athleteId = 'ath_a'
    mocks.epoch = 1
    mocks.chatMessages.length = 0
    mocks.addProposal.mockReset()
    mocks.sendAction.mockReset()
    useChatStore.setState({ messages: [], isLoading: false, currentSessionId: 'session-1' })
  })

  it('no persiste el mensaje del coach ni la propuesta si el atleta cambió durante la IA', async () => {
    mocks.sendAction.mockImplementation(async () => {
      mocks.athleteId = 'ath_b'
      mocks.epoch = 2
      return {
        message: 'Te propongo mover la sesión', provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 0,
        actions: [{ type: 'move_session', sessionId: 's1', targetDate: '2026-08-14', reason: 'x' }],
        meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false },
      }
    })
    await useChatStore.getState().sendMessage('mueve la sesión al viernes', undefined)
    expect(mocks.chatMessages.filter(m => m.role === 'coach')).toHaveLength(0)
    expect(mocks.addProposal).not.toHaveBeenCalled()
    expect(useChatStore.getState().isLoading).toBe(false)
  })

  it('deshace la propuesta si el atleta cambia durante su persistencia', async () => {
    mocks.sendAction.mockResolvedValue({
      message: 'Mover', provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 0,
      actions: [{ type: 'move_session', sessionId: 's1', targetDate: '2026-09-18', reason: 'x' }],
    })
    mocks.addProposal.mockImplementation(async () => { mocks.athleteId = 'ath_b'; mocks.epoch = 2; return { id: 'late' } })
    await useChatStore.getState().sendMessage('mueve la sesión')
    const { db } = await import('../../db/db')
    expect(db.coachProposals.delete).toHaveBeenCalledWith('late')
    expect(db.chatMessages.update).not.toHaveBeenCalled()
    expect(mocks.chatMessages.filter(m => m.role === 'coach')).toEqual([])
    expect(useChatStore.getState().messages.filter(m => m.role === 'coach')).toEqual([])
    expect(useChatStore.getState().isLoading).toBe(false)
  })

  it('no publica errores del request de otro atleta', async () => {
    mocks.sendAction.mockImplementation(async () => { mocks.athleteId = 'ath_b'; mocks.epoch = 2; throw new Error('fallo de A') })
    useChatStore.setState({ error: null })
    await useChatStore.getState().sendMessage('mueve la sesión')
    expect(useChatStore.getState().error).toBeNull()
    expect(useChatStore.getState().isLoading).toBe(false)
  })

  it('pasa el atleta capturado al engine como targetAthleteId', async () => {
    mocks.sendAction.mockResolvedValue({
      message: 'ok', provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 0,
      meta: { hadActionsMarkup: false, actionParseFailed: false, likelyTruncated: false },
    })
    await useChatStore.getState().sendMessage('mueve la sesión al viernes', undefined)
    const options = mocks.sendAction.mock.calls[0][2] as { targetAthleteId?: string | null }
    expect(options.targetAthleteId).toBe('ath_a')
  })

  it('una aclaración estructurada llega al hilo sin propuesta deportiva ni error', async () => {
    mocks.sendAction.mockResolvedValue({
      message: '¿Qué sesión quieres mover?', provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 0,
      conversationEvents: [{ kind: 'ask_clarification', operation: 'move_session', missing: ['sessionId'], known: { targetDate: '2026-09-18' }, summary: 'Mover' }],
      meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false },
    })
    // Task 13 (B4): "muévela al viernes" es justo la anáfora singular sin
    // referente que el resolver de objetivos ahora contesta LOCALMENTE, sin
    // llegar a la IA — ver messageTargets.test.ts / useChatStorePromptContext.
    // Este test cubre el mecanismo de `conversationEvents: ask_clarification`
    // devuelto POR la IA, así que el mensaje se cambia a uno sin objetivo
    // resoluble localmente (`resolveMessageTargets` da `{ kind: 'none' }` para
    // esta frase) para seguir ejercitando ese camino en vez del nuevo.
    await useChatStore.getState().sendMessage('ajusta el entrenamiento de esta semana', undefined)
    expect(mocks.chatMessages.filter(m => m.role === 'coach')).toHaveLength(1)
    expect(mocks.addProposal).not.toHaveBeenCalled()
    expect(useChatStore.getState().error).toBeNull()
    expect(mocks.chatMessages.find(m => m.role === 'user')?.contextMeta).toMatchObject({ contextVersion: 2, route: 'chat_action' })
  })

  it('con un scope capturado que ya no es vigente no persiste ni el mensaje del usuario', async () => {
    // La página capturó para A; antes de llegar al store el holder ya apunta a B.
    const stale = { athleteId: 'ath_a', epoch: 1, conversationId: 'session-1', requestId: 'r1' }
    mocks.athleteId = 'ath_b'
    const result = await useChatStore.getState().sendMessage('mueve la sesión al viernes', undefined, stale)
    expect(result.droppedForScopeChange).toBe(true)
    expect(mocks.chatMessages).toHaveLength(0)
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(useChatStore.getState().isLoading).toBe(false)
  })
})
