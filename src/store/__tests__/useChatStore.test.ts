import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext, ChatMessage, CoachAction } from '../../types'

const mocks = vi.hoisted(() => {
  const chatMessages: ChatMessage[] = []
  return {
    chatMessages,
    deletedMessageIds: [] as string[],
    addShouldFailForRole: undefined as ChatMessage['role'] | undefined,
    routeKind: 'chat_action' as 'chat_general' | 'chat_action' | 'weekly_summary' | 'week_creator' | 'plan_builder_redirect',
    idCounter: 0,
    sessionId: 'session-1',
    sendChat: vi.fn(),
    sendAction: vi.fn(),
    send: vi.fn(),
    sendWeekCreate: vi.fn(),
    addProposal: vi.fn(),
    loadProposals: vi.fn(),
    pushChatMessage: vi.fn(),
    pushCoachProposal: vi.fn(),
    deleteChatMessages: vi.fn(),
    deleteCoachProposals: vi.fn(),
  }
})

vi.mock('../../db/db', () => ({
  db: {
    chatMessages: {
      add: vi.fn(async (message: ChatMessage) => {
        if (mocks.addShouldFailForRole === message.role) throw new Error('Dexie failed')
        mocks.chatMessages.push({ ...message })
      }),
      put: vi.fn(async (message: ChatMessage) => {
        const index = mocks.chatMessages.findIndex(item => item.id === message.id)
        if (index >= 0) mocks.chatMessages[index] = { ...message }
        else mocks.chatMessages.push({ ...message })
      }),
      update: vi.fn(async (id: string, patch: Partial<ChatMessage>) => {
        const message = mocks.chatMessages.find(item => item.id === id)
        if (message) Object.assign(message, patch)
      }),
      delete: vi.fn(async (id: string) => {
        mocks.deletedMessageIds.push(id)
        const index = mocks.chatMessages.findIndex(message => message.id === id)
        if (index >= 0) mocks.chatMessages.splice(index, 1)
      }),
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          sortBy: vi.fn(async () => [...mocks.chatMessages]),
          primaryKeys: vi.fn(async () => mocks.chatMessages.map(message => message.id)),
          delete: vi.fn(async () => {
            mocks.chatMessages.splice(0, mocks.chatMessages.length)
          }),
        })),
      })),
      orderBy: vi.fn(() => ({
        last: vi.fn(async () => mocks.chatMessages.at(-1)),
      })),
    },
    coachProposals: {
      delete: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      where: vi.fn(() => ({
        anyOf: vi.fn(() => ({
          toArray: vi.fn(async () => []),
          delete: vi.fn(async () => undefined),
        })),
      })),
      orderBy: vi.fn(() => ({
        toArray: vi.fn(async () => []),
      })),
    },
    transaction: vi.fn(async (_mode: string, _chatMessages: unknown, _coachProposals: unknown, callback: () => unknown) => callback()),
  },
}))

vi.mock('../../services/ai/CoachEngine', () => ({
  CoachEngine: {
    sendChat: mocks.sendChat,
    sendAction: mocks.sendAction,
    send: mocks.send,
  },
}))

vi.mock('../../services/weekCreator/WeekCreatorEngine', () => ({
  WeekCreatorEngine: {
    sendWeekCreate: mocks.sendWeekCreate,
  },
}))

vi.mock('../useCoachActionsStore', () => ({
  useCoachActionsStore: {
    getState: () => ({
      addProposal: mocks.addProposal,
      loadProposals: mocks.loadProposals,
    }),
  },
}))

vi.mock('../../services/syncService', () => ({
  pushChatMessage: mocks.pushChatMessage,
  pushCoachProposal: mocks.pushCoachProposal,
  deleteChatMessages: mocks.deleteChatMessages,
  deleteCoachProposals: mocks.deleteCoachProposals,
}))

vi.mock('../../services/chatRouting', () => ({
  resolveChatRoute: () => ({ kind: mocks.routeKind }),
}))

vi.mock('../../utils/chatSession', () => ({
  getOrCreateChatSessionId: () => mocks.sessionId,
  isLocalOnlyChatSessionId: () => false,
  setStoredChatSessionId: (id: string) => {
    mocks.sessionId = id
  },
}))

vi.mock('../../utils/uuid', () => ({
  v4: () => {
    mocks.idCounter += 1
    return `id-${mocks.idCounter}`
  },
}))

import { useChatStore } from '../useChatStore'

function makeAction(): CoachAction {
  return {
    type: 'add_session',
    targetDate: '2026-04-30',
    timeBlock: 'PM',
    sessionType: 'running',
    title: 'Rodaje Z2',
    durationMin: 45,
    reason: 'Prueba',
  }
}

function makeContext(): ChatContext {
  return {
    recentSessions: [],
    plannedSessions: [{
      id: 's1',
      date: '2026-04-30',
      timeBlock: 'AM',
      type: 'running',
      status: 'planned',
      title: 'Rodaje',
      durationMin: 40,
      createdAt: 1,
      updatedAt: 1,
    }],
    historicalSessions: [],
    athleteProfile: { id: 'athlete-1', updatedAt: 1 },
    athleteMemory: 'prefiere entrenar tarde',
    intent: 'adjust_session',
  }
}

beforeEach(() => {
  vi.useRealTimers()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  })
  mocks.chatMessages.splice(0, mocks.chatMessages.length)
  mocks.deletedMessageIds.splice(0, mocks.deletedMessageIds.length)
  mocks.addShouldFailForRole = undefined
  mocks.routeKind = 'chat_action'
  mocks.idCounter = 0
  mocks.sessionId = 'session-1'
  mocks.sendChat.mockReset()
  mocks.sendAction.mockReset()
  mocks.send.mockReset()
  mocks.sendWeekCreate.mockReset()
  mocks.addProposal.mockReset()
  mocks.loadProposals.mockReset()
  mocks.pushChatMessage.mockReset()
  mocks.deleteChatMessages.mockReset()
  mocks.deleteCoachProposals.mockReset()
  useChatStore.setState({
    messages: [],
    currentSessionId: 'session-1',
    isLoading: false,
    streamingText: '',
    responsePhase: 'idle',
    error: null,
  })
})

describe('useChatStore.sendMessage', () => {
  it('persists a successful coach response and links its proposal', async () => {
    mocks.sendAction.mockResolvedValue({
      message: 'Listo, preparé la propuesta.',
      actions: [makeAction()],
      provider: 'gemini',
      traceId: 'trace-1',
      requestClass: 'chat_action',
    })
    mocks.addProposal.mockResolvedValue({ id: 'proposal-1' })

    await useChatStore.getState().sendMessage('añade running hoy', makeContext())

    const state = useChatStore.getState()
    expect(mocks.addProposal).toHaveBeenCalledTimes(1)
    expect(state.messages).toHaveLength(2)
    expect(state.messages[0]).toMatchObject({
      role: 'user',
      contextMeta: {
        contextVersion: 1,
        plannedSessionCount: 1,
        hasAthleteProfile: true,
        hasAthleteMemory: true,
      },
    })
    expect(state.messages[0].context).toBeUndefined()
    expect(state.messages[1]).toMatchObject({
      role: 'coach',
      proposalId: 'proposal-1',
      contextMeta: { contextVersion: 1, traceId: 'trace-1' },
    })
  })

  it('removes the optimistic user message when Dexie fails to persist it', async () => {
    mocks.addShouldFailForRole = 'user'

    await useChatStore.getState().sendMessage('añade running hoy', makeContext())

    const state = useChatStore.getState()
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(state.messages).toEqual([])
    expect(state.error).toContain('No se pudo guardar el mensaje')
    expect(state.isLoading).toBe(false)
  })

  it('cleans up the coach message when proposal creation fails', async () => {
    mocks.sendAction.mockResolvedValue({
      message: 'Listo, preparé la propuesta.',
      actions: [makeAction()],
      provider: 'gemini',
      traceId: 'trace-1',
      requestClass: 'chat_action',
    })
    mocks.addProposal.mockRejectedValue(new Error('Proposal failed'))

    await useChatStore.getState().sendMessage('añade running hoy', makeContext())

    const state = useChatStore.getState()
    expect(mocks.deletedMessageIds).toContain('id-2')
    expect(state.messages.map(message => message.role)).toEqual(['user'])
    expect(state.error).toBe('Proposal failed')
  })

  it('persists an inline coach error when week creator fails after the user message is saved', async () => {
    mocks.routeKind = 'week_creator'
    mocks.sendWeekCreate.mockRejectedValue(new Error('El modelo no devolvió ninguna acción create_week.'))

    await useChatStore.getState().sendMessage('Créame una semana', makeContext())

    const state = useChatStore.getState()
    expect(state.messages.map(message => message.role)).toEqual(['user', 'coach'])
    expect(state.messages[1].content).toContain('No pude procesar ese pedido.')
    expect(state.messages[1].content).toContain('create_week')
    expect(mocks.chatMessages.map(message => message.role)).toEqual(['user', 'coach'])
  })

  it('clears loading without adding a coach message when the request is cancelled', async () => {
    mocks.routeKind = 'chat_general'
    mocks.sendChat.mockImplementation((_content: string, _context: ChatContext, options: { signal: AbortSignal }) => (
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    ))

    const pending = useChatStore.getState().sendMessage('hola coach', makeContext())
    await Promise.resolve()
    await useChatStore.getState().newSession()
    await pending

    const state = useChatStore.getState()
    expect(mocks.sendChat).toHaveBeenCalledTimes(1)
    expect(state.isLoading).toBe(false)
    expect(state.streamingText).toBe('')
    expect(state.messages).toEqual([])
  })
})
