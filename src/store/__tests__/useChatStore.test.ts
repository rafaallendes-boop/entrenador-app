import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext, ChatMessage, CoachAction, CoachProposal } from '../../types'
import { AIProviderError } from '../../services/ai/types'
import {
  EntitlementRequiredError,
  buildEntitlementDetail,
} from '../../services/entitlements/entitlementError'

const mocks = vi.hoisted(() => {
  const chatMessages: ChatMessage[] = []
  const coachProposals: CoachProposal[] = []
  return {
    chatMessages,
    coachProposals,
    deletedMessageIds: [] as string[],
    deletedProposalIds: [] as string[],
    addShouldFailForRole: undefined as ChatMessage['role'] | undefined,
    userPersistDurationMs: 0,
    optimizeContextDurationMs: 0,
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
    optimizeContext: vi.fn((context: ChatContext) => context),
  }
})

vi.mock('../../db/db', () => ({
  db: {
    chatMessages: {
      add: vi.fn(async (message: ChatMessage) => {
        if (mocks.addShouldFailForRole === message.role) throw new Error('Dexie failed')
        if (message.role === 'user' && mocks.userPersistDurationMs > 0) {
          vi.setSystemTime(Date.now() + mocks.userPersistDurationMs)
        }
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
      bulkDelete: vi.fn(async (ids: string[]) => {
        for (const id of ids) {
          mocks.deletedMessageIds.push(id)
          const index = mocks.chatMessages.findIndex(message => message.id === id)
          if (index >= 0) mocks.chatMessages.splice(index, 1)
        }
      }),
      where: vi.fn(() => ({
        equals: vi.fn((sessionId: string) => ({
          sortBy: vi.fn(async () =>
            mocks.chatMessages
              .filter(message => message.chatSessionId === sessionId)
              .sort((a, b) => a.timestamp - b.timestamp),
          ),
          toArray: vi.fn(async () =>
            mocks.chatMessages.filter(message => message.chatSessionId === sessionId),
          ),
          primaryKeys: vi.fn(async () =>
            mocks.chatMessages
              .filter(message => message.chatSessionId === sessionId)
              .map(message => message.id),
          ),
          delete: vi.fn(async () => {
            for (let i = mocks.chatMessages.length - 1; i >= 0; i--) {
              if (mocks.chatMessages[i].chatSessionId === sessionId) mocks.chatMessages.splice(i, 1)
            }
          }),
        })),
      })),
      orderBy: vi.fn(() => ({
        last: vi.fn(async () => mocks.chatMessages.at(-1)),
        reverse: vi.fn(() => ({
          filter: vi.fn((predicate: (message: ChatMessage) => boolean) => ({
            first: vi.fn(async () =>
              [...mocks.chatMessages]
                .sort((a, b) => b.timestamp - a.timestamp)
                .find(predicate),
            ),
          })),
        })),
      })),
    },
    coachProposals: {
      delete: vi.fn(async () => undefined),
      bulkDelete: vi.fn(async (ids: string[]) => {
        for (const id of ids) {
          mocks.deletedProposalIds.push(id)
          const index = mocks.coachProposals.findIndex(proposal => proposal.id === id)
          if (index >= 0) mocks.coachProposals.splice(index, 1)
        }
      }),
      put: vi.fn(async (proposal: CoachProposal) => {
        const index = mocks.coachProposals.findIndex(item => item.id === proposal.id)
        if (index >= 0) mocks.coachProposals[index] = { ...proposal }
        else mocks.coachProposals.push({ ...proposal })
      }),
      where: vi.fn(() => ({
        anyOf: vi.fn((messageIds: string[]) => ({
          toArray: vi.fn(async () =>
            mocks.coachProposals.filter(proposal =>
              proposal.chatMessageId != null && messageIds.includes(proposal.chatMessageId),
            ),
          ),
          delete: vi.fn(async () => {
            for (let i = mocks.coachProposals.length - 1; i >= 0; i--) {
              const proposal = mocks.coachProposals[i]
              if (proposal.chatMessageId != null && messageIds.includes(proposal.chatMessageId)) {
                mocks.coachProposals.splice(i, 1)
              }
            }
          }),
        })),
      })),
      orderBy: vi.fn(() => ({
        toArray: vi.fn(async () => [...mocks.coachProposals]),
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

vi.mock('../../services/ai/contextOptimizer', () => ({
  optimizeChatContext: mocks.optimizeContext,
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

vi.mock('../../services/chatRouting', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    resolveChatRoute: () => ({ kind: mocks.routeKind }),
  }
})

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

import { getVisibleCoachStreamText, useChatStore } from '../useChatStore'
import { useAIDebugStore } from '../useAIDebugStore'
import { useEntitlementStore } from '../useEntitlementStore'

describe('chat streaming visibility', () => {
  it('hides internal action JSON while preserving the visible explanation', () => {
    expect(getVisibleCoachStreamText(
      'Voy a mover ambas sesiones.\n\n<actions>[{"type":"move_session"',
      'chat_action',
    )).toBe('Voy a mover ambas sesiones.')
    expect(getVisibleCoachStreamText(
      '{"actions":[{"type":"add_session","exercises":[{"name":"Sentadilla"}]}]}',
      'chat_action',
    )).toBe('')
  })

  it('keeps normal conversational streaming unchanged', () => {
    const text = 'Tu recuperación va bien esta semana.'
    expect(getVisibleCoachStreamText(text, 'chat_general')).toBe(text)
  })
})

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
  mocks.coachProposals.splice(0, mocks.coachProposals.length)
  mocks.deletedMessageIds.splice(0, mocks.deletedMessageIds.length)
  mocks.deletedProposalIds.splice(0, mocks.deletedProposalIds.length)
  mocks.addShouldFailForRole = undefined
  mocks.userPersistDurationMs = 0
  mocks.optimizeContextDurationMs = 0
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
  mocks.optimizeContext.mockReset()
  mocks.optimizeContext.mockImplementation((context: ChatContext) => {
    if (mocks.optimizeContextDurationMs > 0) {
      vi.setSystemTime(Date.now() + mocks.optimizeContextDurationMs)
    }
    return context
  })
  useAIDebugStore.getState().clear()
  useEntitlementStore.setState({ tier: 'free' })
  useChatStore.setState({
    messages: [],
    currentSessionId: 'session-1',
    isLoading: false,
    streamingText: '',
    responsePhase: 'idle',
    error: null,
    conversations: [],
    conversationsStatus: 'idle',
    conversationsDirty: true,
    rotationSuspended: false,
    entitlementOffer: null,
  })
})

describe('useChatStore.sendMessage', () => {
  it('abre la oferta de semana completa sin persistir mensaje ni llamar a IA', () => {
    useChatStore.getState().showEntitlementOffer('week_creator')

    expect(useChatStore.getState().entitlementOffer).toEqual({
      requestClass: 'week_creator',
      requiredTier: 'weekly',
      currentTier: 'free',
    })
    expect(mocks.chatMessages).toHaveLength(0)
    expect(mocks.sendWeekCreate).not.toHaveBeenCalled()
  })

  it('convierte el 403 tipado en una oferta efimera sin persistir una burbuja de error', async () => {
    mocks.routeKind = 'week_creator'
    const detail = buildEntitlementDetail('week_creator', 'weekly', 'free')
    mocks.sendWeekCreate.mockRejectedValueOnce(new EntitlementRequiredError(detail))

    await useChatStore.getState().sendMessage('armame la semana', makeContext())

    const state = useChatStore.getState()
    expect(state.entitlementOffer).toEqual(detail)
    expect(state.error).toBeNull()
    expect(state.isLoading).toBe(false)
    expect(state.responsePhase).toBe('idle')
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]?.role).toBe('user')
    expect(mocks.chatMessages).toHaveLength(1)
    expect(mocks.pushChatMessage).toHaveBeenCalledTimes(1)
  })

  it('mantiene copy seguro si un error entitlement_required pierde su subtipo', async () => {
    mocks.sendAction.mockRejectedValueOnce(
      new AIProviderError('gemini', 'entitlement_required', 'raw provider entitlement payload'),
    )

    await useChatStore.getState().sendMessage('ajusta mi sesión', makeContext())

    const state = useChatStore.getState()
    expect(state.entitlementOffer).toBeNull()
    expect(state.error).toBe('Esta función está en un plan superior. Mirá los planes disponibles.')
    expect(state.error).not.toContain('raw provider')
  })

  it('una respuesta tardia no publica la oferta en otra conversacion', async () => {
    mocks.routeKind = 'week_creator'
    const detail = buildEntitlementDetail('week_creator', 'weekly', 'free')
    let rejectRequest: (reason: unknown) => void = () => undefined
    mocks.sendWeekCreate.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectRequest = reject
    }))

    const pending = useChatStore.getState().sendMessage('armame la semana', makeContext())
    await vi.waitFor(() => expect(mocks.sendWeekCreate).toHaveBeenCalledTimes(1))
    await useChatStore.getState().newSession()
    const nextSessionId = useChatStore.getState().currentSessionId
    rejectRequest(new EntitlementRequiredError(detail))
    await pending

    expect(useChatStore.getState().currentSessionId).toBe(nextSessionId)
    expect(useChatStore.getState().entitlementOffer).toBeNull()
  })

  it('traduce filteredCreateWeek a una oferta efimera para free', async () => {
    mocks.sendAction.mockResolvedValue({
      message: 'Puedo ayudarte a ajustar lo que ya existe.',
      actions: undefined,
      filteredCreateWeek: true,
      provider: 'gemini',
      traceId: 'trace-filtered-free',
      requestClass: 'chat_action',
    })

    await useChatStore.getState().sendMessage('armame la semana', makeContext())

    expect(useChatStore.getState().entitlementOffer).toEqual({
      requestClass: 'week_creator',
      requiredTier: 'weekly',
      currentTier: 'free',
    })
    expect(mocks.chatMessages).toHaveLength(2)
  })

  it.each(['weekly', 'advanced'] as const)(
    '%s no ve la oferta porque puede crear la semana completa',
    async (tier) => {
      useEntitlementStore.setState({ tier })
      mocks.sendAction.mockResolvedValue({
        message: 'Puedo ayudarte a ajustar lo que ya existe.',
        actions: undefined,
        filteredCreateWeek: true,
        provider: 'gemini',
        traceId: `trace-filtered-${tier}`,
        requestClass: 'chat_action',
      })

      await useChatStore.getState().sendMessage('armame la semana', makeContext())

      expect(useChatStore.getState().entitlementOffer).toBeNull()
    },
  )

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
        // El mensaje del usuario ahora siempre lleva la ruta resuelta
        // (A6/F07): buildChatContextMetadata sube a contextVersion 2 cuando
        // hay `route`, que sendMessage siempre calcula. Ver
        // useChatStoreRequestScope.test.ts, que ya fija este mismo valor.
        contextVersion: 2,
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

  it('measures proposal readiness from before user persistence and context optimization', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'))
    mocks.userPersistDurationMs = 250
    mocks.optimizeContextDurationMs = 300
    mocks.sendAction.mockResolvedValue({
      message: 'Listo, preparé la propuesta.',
      actions: [makeAction()],
      provider: 'openai',
      traceId: 'trace-e2e',
      requestClass: 'chat_action',
    })
    mocks.addProposal.mockResolvedValue({ id: 'proposal-e2e' })
    const completeRequest = vi.spyOn(useAIDebugStore.getState(), 'completeRequest')

    await useChatStore.getState().sendMessage('añade running hoy', makeContext())

    expect(completeRequest).toHaveBeenCalledWith('trace-e2e', expect.objectContaining({
      proposalCreated: true,
      endToEndDurationMs: 550,
    }))
    completeRequest.mockRestore()
  })

  it('passes prior thread messages with their timestamps to context optimization', async () => {
    const now = Date.now()
    const priorMessages: ChatMessage[] = [
      { id: 'old-1', role: 'user', content: 'quiero un partido hoy', timestamp: now - 120_000, chatSessionId: 'session-1' },
      { id: 'old-2', role: 'coach', content: 'hoy miércoles no es recomendable', timestamp: now - 60_000, chatSessionId: 'session-1' },
    ]
    useChatStore.setState({ messages: priorMessages })
    mocks.sendAction.mockResolvedValue({
      message: 'Listo, preparé la propuesta.',
      actions: [makeAction()],
      provider: 'gemini',
      traceId: 'trace-ts',
      requestClass: 'chat_action',
    })
    mocks.addProposal.mockResolvedValue({ id: 'proposal-ts' })

    await useChatStore.getState().sendMessage('añade running hoy', makeContext())

    const passedContext = mocks.optimizeContext.mock.calls[0]?.[0] as ChatContext
    expect(passedContext.recentMessages).toEqual([
      { role: 'user', content: 'quiero un partido hoy', timestamp: now - 120_000 },
      { role: 'coach', content: 'hoy miércoles no es recomendable', timestamp: now - 60_000 },
    ])
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
    // id-1 lo consume ahora captureRequestScope (requestId) antes del mensaje
    // del usuario (id-2); el mensaje del coach que se limpia es id-3.
    expect(mocks.deletedMessageIds).toContain('id-3')
    expect(state.messages.map(message => message.role)).toEqual(['user'])
    expect(state.error).toBe('Proposal failed')
  })

  it('persists an inline coach error when week creator fails after the user message is saved', async () => {
    mocks.routeKind = 'week_creator'
    mocks.sendWeekCreate.mockRejectedValue(new Error('El modelo no devolvió ninguna acción create_week.'))
    useChatStore.setState({ conversationsDirty: false })

    await useChatStore.getState().sendMessage('Créame una semana', makeContext())

    const state = useChatStore.getState()
    expect(state.messages.map(message => message.role)).toEqual(['user', 'coach'])
    expect(state.messages[1].content).toContain('create_week')
    expect(state.messages[1].content).toContain('ajustar tu disponibilidad')
    expect(mocks.chatMessages.map(message => message.role)).toEqual(['user', 'coach'])
    expect(state.conversationsDirty).toBe(true)
  })

  it('correlates a successful week creator generation through proposal readiness', async () => {
    mocks.routeKind = 'week_creator'
    mocks.sendWeekCreate.mockImplementation(async (
      _content: string,
      _context: ChatContext,
      options: { generationId: string },
    ) => {
      useAIDebugStore.getState().startRequest({
        traceId: 'trace-week-success',
        generationId: options.generationId,
        attempt: 1,
        requestClass: 'week_creator',
        surface: 'chat',
        startedAt: Date.now(),
      })
      return {
        message: 'Semana lista.',
        actions: [makeAction()],
        provider: 'openai' as const,
        traceId: 'trace-week-success',
        generationId: options.generationId,
        requestClass: 'week_creator' as const,
        fallbackUsed: false,
      }
    })
    mocks.addProposal.mockResolvedValue({ id: 'proposal-week-success' })

    await useChatStore.getState().sendMessage('Créame una semana', makeContext())

    const passedOptions = mocks.sendWeekCreate.mock.calls[0]?.[2] as { generationId?: string }
    expect(passedOptions.generationId).toMatch(/^week_creator-generation-/)
    expect(useAIDebugStore.getState().requests[0]).toMatchObject({
      generationId: passedOptions.generationId,
      status: 'completed',
      proposalCreated: true,
      generationOutcome: 'model_success',
      generationCompletedAt: expect.any(Number),
    })
  })

  it('records end-to-end duration and terminal outcome for a failed week generation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T15:00:00.000Z'))
    mocks.routeKind = 'week_creator'
    mocks.sendWeekCreate.mockImplementation((
      _content: string,
      _context: ChatContext,
      options: { generationId: string },
    ) => {
      useAIDebugStore.getState().startRequest({
        traceId: 'trace-week-failed',
        generationId: options.generationId,
        attempt: 2,
        requestClass: 'week_creator',
        surface: 'chat',
        startedAt: Date.now(),
      })
      vi.setSystemTime(Date.now() + 2_400)
      return Promise.reject(new Error('No pude armar una semana válida esta vez.'))
    })

    await useChatStore.getState().sendMessage('Créame una semana', makeContext())

    expect(useAIDebugStore.getState().requests[0]).toMatchObject({
      traceId: 'trace-week-failed',
      status: 'failed',
      proposalCreated: false,
      endToEndDurationMs: 2_400,
      generationOutcome: 'failed',
      generationCompletedAt: expect.any(Number),
    })
  })

  it('records a resolved local schedule rejection as a failed logical generation', async () => {
    mocks.routeKind = 'week_creator'
    mocks.sendWeekCreate.mockImplementation(async (
      _content: string,
      _context: ChatContext,
      options: { generationId: string },
    ) => {
      useAIDebugStore.getState().startRequest({
        traceId: 'trace-week-capacity',
        generationId: options.generationId,
        attempt: 1,
        requestClass: 'week_creator',
        surface: 'chat',
        startedAt: Date.now(),
        status: 'failed',
        errorCode: 'insufficient_schedule_capacity',
      })
      return {
        message: 'No puedo ubicar 6 sesiones: hay 5 bloques disponibles.',
        actions: [],
        provider: 'mock' as const,
        traceId: 'trace-week-capacity',
        generationId: options.generationId,
        requestClass: 'week_creator' as const,
        fallbackUsed: false,
      }
    })

    await useChatStore.getState().sendMessage('Créame una semana', makeContext())

    expect(mocks.addProposal).not.toHaveBeenCalled()
    expect(useChatStore.getState().error).toBeNull()
    expect(useChatStore.getState().messages.at(-1)?.content).toContain('5 bloques disponibles')
    expect(useAIDebugStore.getState().requests[0]).toMatchObject({
      traceId: 'trace-week-capacity',
      status: 'failed',
      proposalCreated: false,
      generationOutcome: 'failed',
      endToEndDurationMs: expect.any(Number),
    })
    expect(useAIDebugStore.getState().requests[0]?.proposalReadyAt).toBeUndefined()
  })

  it('keeps a Week Creator safety decline completed without a proposal', async () => {
    mocks.routeKind = 'week_creator'
    mocks.sendWeekCreate.mockImplementation(async (
      _content: string,
      _context: ChatContext,
      options: { generationId: string },
    ) => {
      useAIDebugStore.getState().startRequest({
        traceId: 'trace-week-safety-decline',
        generationId: options.generationId,
        attempt: 1,
        requestClass: 'week_creator',
        surface: 'chat',
        startedAt: Date.now(),
      })
      return {
        message: 'No pude verificar una sesión de fuerza compatible con la restricción registrada.',
        actions: [],
        provider: 'mock' as const,
        traceId: 'trace-week-safety-decline',
        generationId: options.generationId,
        requestClass: 'week_creator' as const,
        fallbackUsed: false,
        meta: {
          hadActionsMarkup: false,
          actionParseFailed: false,
          likelyTruncated: false,
          outcome: 'safety_blocked' as const,
        },
      }
    })

    await useChatStore.getState().sendMessage('Créame una semana', makeContext())

    expect(mocks.addProposal).not.toHaveBeenCalled()
    expect(useChatStore.getState().error).toBeNull()
    expect(useAIDebugStore.getState().requests[0]).toMatchObject({
      traceId: 'trace-week-safety-decline',
      status: 'completed',
      proposalCreated: false,
      generationOutcome: 'safe_decline',
    })
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

  it('keeps an active request loading when an invalid conversation is opened', async () => {
    mocks.routeKind = 'chat_general'
    mocks.sendChat.mockImplementation((
      _content: string,
      _context: ChatContext,
      options: { signal: AbortSignal },
    ) => (
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      })
    ))

    const pending = useChatStore.getState().sendMessage('hola coach', makeContext())
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.sendChat).toHaveBeenCalledTimes(1)

    await useChatStore.getState().openConversation('missing-session')
    expect(useChatStore.getState().isLoading).toBe(true)
    expect(useChatStore.getState().responsePhase).toBe('connecting')

    await useChatStore.getState().newSession()
    await pending
  })
})

describe('daily rotation on send', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 26, 8, 0))
    mocks.routeKind = 'chat_general'
    mocks.sendChat.mockResolvedValue({
      message: 'Entendido.',
      actions: [],
      provider: 'openai',
      traceId: 'trace-daily-rotation',
      requestClass: 'chat_general',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rotates before building the provider history when the thread is from yesterday', async () => {
    useChatStore.setState({
      isLoading: false,
      rotationSuspended: false,
      currentSessionId: 'yesterday-session',
      messages: [{
        id: 'old',
        role: 'user',
        content: 'lo de ayer',
        timestamp: new Date(2026, 6, 25, 20, 0).getTime(),
        chatSessionId: 'yesterday-session',
      } as ChatMessage],
    })

    await useChatStore.getState().sendMessage('hoy quiero entrenar')

    const state = useChatStore.getState()
    expect(state.currentSessionId).not.toBe('yesterday-session')
    expect(state.messages.some(message => message.id === 'old')).toBe(false)
    const passedContext = mocks.sendChat.mock.calls[0]?.[1] as ChatContext
    expect(passedContext.recentMessages).toEqual([])
  })

  it('does not rotate when the user explicitly opened an old conversation', async () => {
    useChatStore.setState({
      isLoading: false,
      rotationSuspended: true,
      currentSessionId: 'yesterday-session',
      messages: [{
        id: 'old',
        role: 'user',
        content: 'lo de ayer',
        timestamp: new Date(2026, 6, 25, 20, 0).getTime(),
        chatSessionId: 'yesterday-session',
      } as ChatMessage],
    })

    await useChatStore.getState().sendMessage('sigo con esto')

    expect(useChatStore.getState().currentSessionId).toBe('yesterday-session')
  })

  it('does not rotate while a request is in flight', async () => {
    useChatStore.setState({
      isLoading: true,
      rotationSuspended: false,
      currentSessionId: 'yesterday-session',
      messages: [{
        id: 'old',
        role: 'user',
        content: 'x',
        timestamp: new Date(2026, 6, 25, 20, 0).getTime(),
        chatSessionId: 'yesterday-session',
      } as ChatMessage],
    })

    await useChatStore.getState().sendMessage('nuevo')

    expect(useChatStore.getState().currentSessionId).toBe('yesterday-session')
    expect(mocks.sendChat).not.toHaveBeenCalled()
  })

  it('produces one rotation and one provider request for two sends in the same tick', async () => {
    useChatStore.setState({
      isLoading: false,
      rotationSuspended: false,
      currentSessionId: 'yesterday-session',
      messages: [{
        id: 'old',
        role: 'user',
        content: 'lo de ayer',
        timestamp: new Date(2026, 6, 25, 20, 0).getTime(),
        chatSessionId: 'yesterday-session',
      } as ChatMessage],
    })

    const first = useChatStore.getState().sendMessage('uno')
    const second = useChatStore.getState().sendMessage('dos')
    await Promise.all([first, second])

    expect(mocks.sendChat).toHaveBeenCalledTimes(1)
  })
})

describe('scoping por atleta del thread de chat', () => {
  const seedMixedThread = () => {
    const now = Date.now()
    mocks.chatMessages.push(
      {
        id: 'msg-self', role: 'user', content: 'hola (self/legacy)', timestamp: now - 1,
        chatSessionId: 'session-1',
      } as ChatMessage,
      {
        id: 'msg-managed', role: 'user', content: 'hola (managed)', timestamp: now,
        chatSessionId: 'session-1', athleteId: 'ath_m_1',
      } as ChatMessage,
    )
  }

  const seedMixedThreadWithProposals = () => {
    seedMixedThread()
    mocks.coachProposals.push(
      {
        id: 'proposal-self',
        chatMessageId: 'msg-self',
        message: 'self proposal',
        actions: [],
        status: 'pending',
        createdAt: 1,
      },
      {
        id: 'proposal-managed',
        chatMessageId: 'msg-managed',
        message: 'managed proposal',
        actions: [],
        status: 'pending',
        createdAt: 2,
        athleteId: 'ath_m_1',
      },
    )
  }

  it('loadHistory con gestionado activo no muestra mensajes legacy/self del mismo chatSessionId', async () => {
    const { setActiveAthleteId, setSelfAthleteId } = await import('../../services/athlete/activeAthlete')
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    try {
      seedMixedThread()
      const { useChatStore } = await import('../useChatStore')
      await useChatStore.getState().loadHistory()
      expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['msg-managed'])
    } finally {
      setActiveAthleteId(null)
      setSelfAthleteId(null)
    }
  })

  it('deleteCurrentSession con gestionado activo borra solo sus mensajes, no los del self', async () => {
    const { setActiveAthleteId, setSelfAthleteId } = await import('../../services/athlete/activeAthlete')
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    try {
      seedMixedThread()
      const { useChatStore } = await import('../useChatStore')
      useChatStore.setState({ currentSessionId: 'session-1' })

      await useChatStore.getState().deleteCurrentSession()

      // El mensaje legacy/self sobrevive local y NO se pide su borrado remoto.
      expect(mocks.chatMessages.map((m) => m.id)).toEqual(['msg-self'])
      expect(mocks.deleteChatMessages).toHaveBeenCalledWith(['msg-managed'])
      expect(mocks.deletedMessageIds).not.toContain('msg-self')
    } finally {
      setActiveAthleteId(null)
      setSelfAthleteId(null)
    }
  })

  it('deleteCurrentSession borra solo propuestas vinculadas a mensajes in-scope', async () => {
    const { setActiveAthleteId, setSelfAthleteId } = await import('../../services/athlete/activeAthlete')
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    try {
      seedMixedThreadWithProposals()
      const { useChatStore } = await import('../useChatStore')
      useChatStore.setState({ currentSessionId: 'session-1' })

      await useChatStore.getState().deleteCurrentSession()

      expect(mocks.coachProposals.map((proposal) => proposal.id)).toEqual(['proposal-self'])
      expect(mocks.deleteCoachProposals).toHaveBeenCalledWith(['proposal-managed'])
      expect(mocks.deletedProposalIds).toEqual(['proposal-managed'])
    } finally {
      setActiveAthleteId(null)
      setSelfAthleteId(null)
    }
  })
})
