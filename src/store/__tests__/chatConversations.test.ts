import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, CoachProposal } from '../../types'
import type { ConversationSummary } from '../../services/chat/conversationIndex'

interface RepairPlan {
  gate?: Promise<void>
  entered?: () => void
  error?: Error
}

const mocks = vi.hoisted(() => ({
  chatMessages: [] as ChatMessage[],
  coachProposals: [] as CoachProposal[],
  deletedMessageIds: [] as string[],
  deletedProposalIds: [] as string[],
  storedSessionId: null as string | null,
  localOnly: false,
  setStoredCalls: [] as string[],
  conversations: [] as ConversationSummary[],
  deferNextList: false,
  listResolvers: [] as Array<(value: ConversationSummary[]) => void>,
  repairPlans: [] as RepairPlan[],
  messageReadPlans: [] as RepairPlan[],
  uuidCounter: 0,
  deleteChatMessages: vi.fn(),
  deleteCoachProposals: vi.fn(),
  loadProposals: vi.fn(),
  sendChat: vi.fn(),
}))

vi.mock('../../db/db', () => ({
  db: {
    chatMessages: {
      where: () => ({
        equals: (id: string) => ({
          toArray: async () => {
            const rows = mocks.chatMessages.filter(message => message.chatSessionId === id)
            const plan = mocks.messageReadPlans.shift()
            plan?.entered?.()
            if (plan?.gate) await plan.gate
            return rows
          },
          sortBy: async () => mocks.chatMessages
            .filter(message => message.chatSessionId === id)
            .sort((a, b) => a.timestamp - b.timestamp),
        }),
      }),
      orderBy: () => ({
        toArray: async () => [...mocks.chatMessages].sort((a, b) => a.timestamp - b.timestamp),
        reverse: () => ({
          filter: (predicate: (message: ChatMessage) => boolean) => ({
            first: async () => [...mocks.chatMessages]
              .sort((a, b) => b.timestamp - a.timestamp)
              .find(predicate),
          }),
        }),
      }),
      add: vi.fn(async (message: ChatMessage) => {
        mocks.chatMessages.push(message)
      }),
      put: vi.fn(async () => undefined),
      bulkDelete: vi.fn(async (ids: string[]) => {
        mocks.deletedMessageIds.push(...ids)
        for (const id of ids) {
          const index = mocks.chatMessages.findIndex(message => message.id === id)
          if (index >= 0) mocks.chatMessages.splice(index, 1)
        }
      }),
    },
    coachProposals: {
      where: () => ({
        anyOf: (messageIds: string[]) => ({
          toArray: async () => mocks.coachProposals.filter(proposal =>
            proposal.chatMessageId != null && messageIds.includes(proposal.chatMessageId)
          ),
        }),
      }),
      orderBy: () => ({ toArray: async () => [...mocks.coachProposals] }),
      put: vi.fn(async () => undefined),
      bulkDelete: vi.fn(async (ids: string[]) => {
        mocks.deletedProposalIds.push(...ids)
        for (const id of ids) {
          const index = mocks.coachProposals.findIndex(proposal => proposal.id === id)
          if (index >= 0) mocks.coachProposals.splice(index, 1)
        }
      }),
    },
    transaction: vi.fn(async (_mode: string, ...args: unknown[]) => {
      const work = args[args.length - 1] as () => Promise<unknown>
      return work()
    }),
  },
}))

vi.mock('../../utils/chatSession', () => ({
  getOrCreateChatSessionId: () => mocks.storedSessionId ?? 'fresh-session',
  setStoredChatSessionId: (id: string) => {
    mocks.setStoredCalls.push(id)
    mocks.storedSessionId = id
    mocks.localOnly = false
  },
  isLocalOnlyChatSessionId: () => mocks.localOnly,
}))

vi.mock('../../utils/uuid', () => ({
  v4: () => {
    mocks.uuidCounter += 1
    return `new-session-${mocks.uuidCounter}`
  },
}))

vi.mock('../../services/chat/conversationIndex', () => ({
  listConversations: vi.fn(() => {
    if (mocks.deferNextList) {
      mocks.deferNextList = false
      return new Promise<ConversationSummary[]>((resolve) => {
        mocks.listResolvers.push(resolve)
      })
    }
    return Promise.resolve(mocks.conversations)
  }),
  searchConversations: vi.fn(async () => []),
}))

vi.mock('../../services/chat/orphanProposalRepair', () => ({
  repairOrphanProposalMessages: vi.fn(async (
    _sessionId: string,
    messages: ChatMessage[],
  ) => {
    const plan = mocks.repairPlans.shift()
    plan?.entered?.()
    if (plan?.gate) await plan.gate
    if (plan?.error) throw plan.error
    return messages
  }),
}))

vi.mock('../../services/syncService', () => ({
  pushChatMessage: vi.fn(),
  deleteChatMessages: mocks.deleteChatMessages,
  deleteCoachProposals: mocks.deleteCoachProposals,
}))

vi.mock('../../services/chatRouting', () => ({
  resolveChatRoute: () => ({ kind: 'chat_general' }),
}))

vi.mock('../../services/ai/contextOptimizer', () => ({
  optimizeChatContext: (context: unknown) => context,
}))

vi.mock('../../services/ai/CoachEngine', () => ({
  CoachEngine: {
    sendChat: mocks.sendChat,
  },
}))

vi.mock('../useCoachActionsStore', () => ({
  useCoachActionsStore: {
    getState: () => ({
      loadProposals: mocks.loadProposals,
    }),
  },
}))

const { useChatStore } = await import('../useChatStore')

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id'>): ChatMessage {
  return {
    role: 'user',
    content: 'texto',
    timestamp: Date.now(),
    chatSessionId: 'current-session',
    ...overrides,
  } as ChatMessage
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  })
  mocks.chatMessages.length = 0
  mocks.coachProposals.length = 0
  mocks.deletedMessageIds.length = 0
  mocks.deletedProposalIds.length = 0
  mocks.setStoredCalls.length = 0
  mocks.conversations = []
  mocks.deferNextList = false
  mocks.listResolvers.length = 0
  mocks.repairPlans.length = 0
  mocks.messageReadPlans.length = 0
  mocks.storedSessionId = 'current-session'
  mocks.localOnly = false
  mocks.uuidCounter = 0
  mocks.deleteChatMessages.mockReset()
  mocks.deleteCoachProposals.mockReset()
  mocks.loadProposals.mockReset()
  mocks.sendChat.mockReset()
  useChatStore.setState({
    messages: [],
    currentSessionId: 'current-session',
    isLoading: false,
    streamingText: '',
    responsePhase: 'idle',
    error: null,
    conversations: [],
    conversationsStatus: 'idle',
    conversationsDirty: true,
    rotationSuspended: false,
  })
})

describe('loadHistory', () => {
  beforeEach(() => {
    mocks.localOnly = true
  })

  it('resets rotationSuspended so a fresh entry re-applies the day rule', async () => {
    useChatStore.setState({ rotationSuspended: true })
    await useChatStore.getState().loadHistory()
    expect(useChatStore.getState().rotationSuspended).toBe(false)
  })

  it('keeps the local-only marker alive so adoption still works', async () => {
    await useChatStore.getState().loadHistory()
    expect(mocks.setStoredCalls).toEqual([])
  })

  it('adopts a same-day thread when the current session is empty and local-only', async () => {
    mocks.chatMessages.push(message({
      id: 'same-day',
      content: 'hola',
      chatSessionId: 'older-thread',
    }))

    await useChatStore.getState().loadHistory()

    expect(useChatStore.getState().currentSessionId).toBe('older-thread')
    expect(mocks.setStoredCalls).toEqual(['older-thread'])
  })

  it('does not adopt a thread from a previous day', async () => {
    mocks.chatMessages.push(message({
      id: 'previous-day',
      content: 'ayer',
      timestamp: Date.now() - 40 * 60 * 60 * 1000,
      chatSessionId: 'older-thread',
    }))

    await useChatStore.getState().loadHistory()

    expect(useChatStore.getState().currentSessionId).toBe('current-session')
    expect(mocks.setStoredCalls).toEqual([])
  })

  it('adopts a valid earlier thread even when the newest row has no session', async () => {
    const now = Date.now()
    mocks.chatMessages.push(
      message({
        id: 'valid',
        content: 'con sesión',
        timestamp: now - 1000,
        chatSessionId: 'older-thread',
      }),
      message({
        id: 'orphan',
        content: 'sin sesión',
        timestamp: now,
        chatSessionId: undefined,
      }),
    )

    await useChatStore.getState().loadHistory()

    expect(useChatStore.getState().currentSessionId).toBe('older-thread')
  })

  it('cannot reinstall a loaded thread after a new session starts', async () => {
    mocks.localOnly = false
    mocks.chatMessages.push(message({ id: 'current-message' }))

    let releaseRepair = () => undefined
    let markEntered = () => undefined
    const repairEntered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const repairGate = new Promise<void>((resolve) => {
      releaseRepair = resolve
    })
    mocks.repairPlans.push({ gate: repairGate, entered: markEntered })

    const loading = useChatStore.getState().loadHistory()
    await repairEntered
    await useChatStore.getState().newSession()
    const newSessionId = useChatStore.getState().currentSessionId
    releaseRepair()
    await loading

    expect(useChatStore.getState().currentSessionId).toBe(newSessionId)
    expect(useChatStore.getState().messages).toEqual([])
  })
})

describe('openConversation', () => {
  beforeEach(() => {
    mocks.chatMessages.push(message({
      id: 'old',
      content: 'Me duele el hombro',
      timestamp: 1000,
      chatSessionId: 'old-thread',
    }))
  })

  it('opens an existing conversation and suspends rotation', async () => {
    useChatStore.setState({ isLoading: true, responsePhase: 'responding' })
    await useChatStore.getState().openConversation('old-thread')

    const state = useChatStore.getState()
    expect(state.currentSessionId).toBe('old-thread')
    expect(state.messages.map(item => item.id)).toEqual(['old'])
    expect(state.isLoading).toBe(false)
    expect(state.responsePhase).toBe('idle')
    expect(state.rotationSuspended).toBe(true)
    expect(mocks.setStoredCalls).toEqual(['old-thread'])
  })

  it('refuses an unknown id without touching the current conversation', async () => {
    await useChatStore.getState().openConversation('does-not-exist')

    const state = useChatStore.getState()
    expect(state.currentSessionId).toBe('current-session')
    expect(state.rotationSuspended).toBe(false)
    expect(state.error).toBeTruthy()
    expect(mocks.setStoredCalls).toEqual([])
  })

  it('lets the last of two chained opens win', async () => {
    mocks.chatMessages.push(message({
      id: 'other',
      content: 'Quiero correr',
      timestamp: 2000,
      chatSessionId: 'other-thread',
    }))

    const first = useChatStore.getState().openConversation('old-thread')
    const second = useChatStore.getState().openConversation('other-thread')
    await Promise.all([first, second])

    expect(useChatStore.getState().currentSessionId).toBe('other-thread')
    expect(mocks.setStoredCalls).toEqual(['other-thread'])
  })

  it('does not commit when the first open stalls inside proposal repair', async () => {
    mocks.chatMessages.push(message({
      id: 'other',
      content: 'Quiero correr',
      timestamp: 2000,
      chatSessionId: 'other-thread',
    }))

    let releaseFirst = () => undefined
    let markEntered = () => undefined
    const firstEntered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    mocks.repairPlans.push({ gate: firstGate, entered: markEntered })

    const first = useChatStore.getState().openConversation('old-thread')
    await firstEntered
    const second = useChatStore.getState().openConversation('other-thread')
    await second
    releaseFirst()
    await first

    expect(useChatStore.getState().currentSessionId).toBe('other-thread')
    expect(useChatStore.getState().messages.map(item => item.id)).toEqual(['other'])
    expect(mocks.setStoredCalls).toEqual(['other-thread'])
  })

  it('keeps the current conversation when proposal repair fails', async () => {
    mocks.repairPlans.push({ error: new Error('repair failed') })
    useChatStore.setState({
      messages: [message({ id: 'visible' })],
      isLoading: true,
      responsePhase: 'responding',
    })

    await useChatStore.getState().openConversation('old-thread')

    const state = useChatStore.getState()
    expect(state.currentSessionId).toBe('current-session')
    expect(state.messages.map(item => item.id)).toEqual(['visible'])
    expect(state.isLoading).toBe(false)
    expect(state.responsePhase).toBe('idle')
    expect(state.rotationSuspended).toBe(false)
    expect(state.error).toBe('No se pudo cargar la conversación.')
    expect(mocks.setStoredCalls).toEqual([])
  })

  it('clears orphan loading when a valid open is superseded by an invalid one', async () => {
    let releaseRepair = () => undefined
    let markEntered = () => undefined
    const repairEntered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const repairGate = new Promise<void>((resolve) => {
      releaseRepair = resolve
    })
    mocks.repairPlans.push({ gate: repairGate, entered: markEntered })
    useChatStore.setState({
      isLoading: true,
      streamingText: 'respuesta parcial',
      responsePhase: 'responding',
    })

    const validOpen = useChatStore.getState().openConversation('old-thread')
    await repairEntered
    await useChatStore.getState().openConversation('does-not-exist')

    const state = useChatStore.getState()
    expect(state.currentSessionId).toBe('current-session')
    expect(state.isLoading).toBe(false)
    expect(state.streamingText).toBe('')
    expect(state.responsePhase).toBe('idle')
    expect(state.error).toBe('No encontramos esa conversación.')

    releaseRepair()
    await validOpen
    expect(useChatStore.getState().currentSessionId).toBe('current-session')
  })

  it('clears loading when validation becomes delete-stale after another open aborted the request', async () => {
    mocks.chatMessages.push(
      message({ id: 'thread-t', chatSessionId: 'thread-t' }),
      message({ id: 'thread-s', chatSessionId: 'thread-s' }),
    )
    mocks.sendChat.mockImplementation((
      _content: string,
      _context: unknown,
      options: { signal: AbortSignal },
    ) => new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      )
    }))
    const sending = useChatStore.getState().sendMessage('request activa')
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.sendChat).toHaveBeenCalledTimes(1)

    let releaseRepairT = () => undefined
    let markRepairTEntered = () => undefined
    const repairTEntered = new Promise<void>((resolve) => {
      markRepairTEntered = resolve
    })
    const repairTGate = new Promise<void>((resolve) => {
      releaseRepairT = resolve
    })
    mocks.repairPlans.push({ gate: repairTGate, entered: markRepairTEntered })
    const openingT = useChatStore.getState().openConversation('thread-t')
    await repairTEntered
    expect(useChatStore.getState().isLoading).toBe(true)

    let releaseValidationS = () => undefined
    let markValidationSEntered = () => undefined
    const validationSEntered = new Promise<void>((resolve) => {
      markValidationSEntered = resolve
    })
    const validationSGate = new Promise<void>((resolve) => {
      releaseValidationS = resolve
    })
    mocks.messageReadPlans.push({
      gate: validationSGate,
      entered: markValidationSEntered,
    })
    const openingS = useChatStore.getState().openConversation('thread-s')
    await validationSEntered

    await useChatStore.getState().deleteConversation('thread-s')
    releaseValidationS()
    await openingS

    expect(useChatStore.getState().isLoading).toBe(false)
    expect(useChatStore.getState().streamingText).toBe('')
    expect(useChatStore.getState().responsePhase).toBe('idle')
    expect(useChatStore.getState().currentSessionId).toBe('current-session')

    releaseRepairT()
    await Promise.all([openingT, sending])
  })

  it('does not commit a snapshot whose conversation was deleted during repair', async () => {
    let releaseRepair = () => undefined
    let markEntered = () => undefined
    const repairEntered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const repairGate = new Promise<void>((resolve) => {
      releaseRepair = resolve
    })
    mocks.repairPlans.push({ gate: repairGate, entered: markEntered })
    useChatStore.setState({
      isLoading: true,
      streamingText: 'respuesta parcial',
      responsePhase: 'responding',
    })

    const opening = useChatStore.getState().openConversation('old-thread')
    await repairEntered
    await useChatStore.getState().deleteConversation('old-thread')
    releaseRepair()
    await opening

    expect(useChatStore.getState().currentSessionId).toBe('current-session')
    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().isLoading).toBe(false)
    expect(useChatStore.getState().streamingText).toBe('')
    expect(useChatStore.getState().responsePhase).toBe('idle')
    expect(mocks.setStoredCalls).toEqual([])
  })

  it('refuses to open a conversation while its deletion is in flight', async () => {
    let releaseDelete = () => undefined
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve
    })
    mocks.deleteChatMessages.mockImplementationOnce(() => deleteGate)

    const deleting = useChatStore.getState().deleteConversation('old-thread')
    await useChatStore.getState().openConversation('old-thread')

    expect(useChatStore.getState().currentSessionId).toBe('current-session')
    expect(useChatStore.getState().error).toBe('Esa conversación se está eliminando.')
    expect(mocks.setStoredCalls).toEqual([])

    releaseDelete()
    await deleting
  })

  it('does not cancel another thread opening when the deleted thread is requested', async () => {
    mocks.chatMessages.push(message({
      id: 'other',
      content: 'Otro hilo',
      chatSessionId: 'other-thread',
    }))
    let releaseRepair = () => undefined
    let markRepairEntered = () => undefined
    const repairEntered = new Promise<void>((resolve) => {
      markRepairEntered = resolve
    })
    const repairGate = new Promise<void>((resolve) => {
      releaseRepair = resolve
    })
    mocks.repairPlans.push({ gate: repairGate, entered: markRepairEntered })

    const openingOther = useChatStore.getState().openConversation('other-thread')
    await repairEntered

    let releaseDelete = () => undefined
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve
    })
    mocks.deleteChatMessages.mockImplementationOnce(() => deleteGate)
    const deletingOld = useChatStore.getState().deleteConversation('old-thread')
    await useChatStore.getState().openConversation('old-thread')

    releaseRepair()
    await openingOther
    expect(useChatStore.getState().currentSessionId).toBe('other-thread')
    expect(mocks.setStoredCalls).toEqual(['other-thread'])

    releaseDelete()
    await deletingOld
  })
})

describe('loadConversations', () => {
  beforeEach(() => {
    mocks.conversations = [{
      sessionId: 's1',
      title: 'Hombro',
      lastMessageAt: 200,
      firstMessageAt: 100,
      messageCount: 3,
    }]
  })

  it('loads the index and marks it clean', async () => {
    await useChatStore.getState().loadConversations()

    const state = useChatStore.getState()
    expect(state.conversations.map(item => item.sessionId)).toEqual(['s1'])
    expect(state.conversationsStatus).toBe('ready')
    expect(state.conversationsDirty).toBe(false)
  })

  it('keeps the last valid list and stays dirty on error', async () => {
    await useChatStore.getState().loadConversations()
    const { listConversations } = await import('../../services/chat/conversationIndex')
    vi.mocked(listConversations).mockRejectedValueOnce(new Error('dexie down'))

    await useChatStore.getState().loadConversations()

    const state = useChatStore.getState()
    expect(state.conversationsStatus).toBe('error')
    expect(state.conversations.map(item => item.sessionId)).toEqual(['s1'])
    expect(state.conversationsDirty).toBe(true)
  })

  it('clears the index on athlete switch', () => {
    useChatStore.setState({
      conversations: mocks.conversations,
      conversationsStatus: 'ready',
      rotationSuspended: true,
    })

    useChatStore.getState().resetForAthleteSwitch()

    const state = useChatStore.getState()
    expect(state.conversations).toEqual([])
    expect(state.conversationsStatus).toBe('idle')
    expect(state.rotationSuspended).toBe(false)
  })

  it('discards a load that resolves after an athlete switch', async () => {
    mocks.deferNextList = true
    const pending = useChatStore.getState().loadConversations()
    const resolveLate = mocks.listResolvers[0]

    useChatStore.getState().resetForAthleteSwitch()
    resolveLate([{
      sessionId: 'stale',
      title: 'De otro atleta',
      lastMessageAt: 1,
      firstMessageAt: 1,
      messageCount: 1,
    }])
    await pending

    const state = useChatStore.getState()
    expect(state.conversations).toEqual([])
    expect(state.conversationsStatus).toBe('idle')
  })
})

describe('deleteConversation', () => {
  beforeEach(() => {
    mocks.chatMessages.push(
      message({ id: 'cur', content: 'hoy', timestamp: 900 }),
      message({
        id: 'old',
        content: 'ayer',
        timestamp: 100,
        chatSessionId: 'old-thread',
      }),
    )
  })

  it('deletes only the targeted conversation and leaves the current one alone', async () => {
    await useChatStore.getState().deleteConversation('old-thread')

    expect(mocks.deletedMessageIds).toEqual(['old'])
    expect(mocks.chatMessages.map(item => item.id)).toEqual(['cur'])
    expect(useChatStore.getState().currentSessionId).toBe('current-session')
  })

  it('starts a new session only when the current conversation is deleted', async () => {
    await useChatStore.getState().deleteConversation('current-session')

    expect(mocks.deletedMessageIds).toEqual(['cur'])
    expect(useChatStore.getState().currentSessionId).not.toBe('current-session')
  })

  it('refreshes the index after deleting', async () => {
    const { listConversations } = await import('../../services/chat/conversationIndex')
    vi.mocked(listConversations).mockClear()

    await useChatStore.getState().deleteConversation('old-thread')

    expect(listConversations).toHaveBeenCalled()
    expect(useChatStore.getState().conversationsDirty).toBe(false)
  })

  it('does not start a new session if the user switched conversation mid-delete', async () => {
    let releaseDelete = () => undefined
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve
    })
    mocks.deleteChatMessages.mockImplementationOnce(() => deleteGate)

    const deleting = useChatStore.getState().deleteConversation('current-session')
    await Promise.resolve()
    useChatStore.setState({ currentSessionId: 'old-thread' })
    releaseDelete()
    await deleting

    expect(useChatStore.getState().currentSessionId).toBe('old-thread')
  })

  it('deleteCurrentSession delegates to deleteConversation', async () => {
    const spy = vi.spyOn(useChatStore.getState(), 'deleteConversation')
    await useChatStore.getState().deleteCurrentSession()
    expect(spy).toHaveBeenCalledWith('current-session')
  })

  it('keeps the delete guard until every concurrent delete of the id finishes', async () => {
    let releaseFirst = () => undefined
    let releaseSecond = () => undefined
    let markFirstStarted = () => undefined
    let markSecondStarted = () => undefined
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve
    })
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    mocks.deleteChatMessages
      .mockImplementationOnce(() => {
        markFirstStarted()
        return firstGate
      })
      .mockImplementationOnce(() => {
        markSecondStarted()
        return secondGate
      })

    const firstDelete = useChatStore.getState().deleteConversation('old-thread')
    const secondDelete = useChatStore.getState().deleteConversation('old-thread')
    await Promise.all([firstStarted, secondStarted])

    releaseFirst()
    await firstDelete
    mocks.chatMessages.push(message({
      id: 'reappeared',
      content: 'snapshot tardío',
      chatSessionId: 'old-thread',
    }))

    await useChatStore.getState().openConversation('old-thread')
    expect(useChatStore.getState().currentSessionId).toBe('current-session')
    expect(mocks.setStoredCalls).toEqual([])

    releaseSecond()
    await secondDelete
  })

  it('does not derive delete ids when the athlete switches during the first read', async () => {
    const {
      bumpSwitchEpoch,
      setActiveAthleteId,
      setSelfAthleteId,
    } = await import('../../services/athlete/activeAthlete')
    const { listConversations } = await import('../../services/chat/conversationIndex')
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    mocks.chatMessages.push(message({
      id: 'managed-old',
      content: 'otro atleta',
      chatSessionId: 'old-thread',
      athleteId: 'ath_managed',
    }))

    let releaseRead = () => undefined
    let markReadEntered = () => undefined
    const readEntered = new Promise<void>((resolve) => {
      markReadEntered = resolve
    })
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    mocks.messageReadPlans.push({ gate: readGate, entered: markReadEntered })
    vi.mocked(listConversations).mockClear()

    try {
      const deleting = useChatStore.getState().deleteConversation('old-thread')
      await readEntered

      bumpSwitchEpoch()
      useChatStore.getState().resetForAthleteSwitch()
      setActiveAthleteId('ath_managed')
      const managedIndex: ConversationSummary[] = [{
        sessionId: 'managed-current',
        title: 'Managed',
        lastMessageAt: 2,
        firstMessageAt: 1,
        messageCount: 1,
      }]
      useChatStore.setState({
        currentSessionId: 'managed-current',
        conversations: managedIndex,
        conversationsStatus: 'ready',
        conversationsDirty: false,
      })

      releaseRead()
      await deleting

      expect(mocks.deletedMessageIds).toEqual([])
      expect(mocks.deleteChatMessages).not.toHaveBeenCalled()
      expect(mocks.deleteCoachProposals).not.toHaveBeenCalled()
      expect(listConversations).not.toHaveBeenCalled()
      expect(useChatStore.getState()).toMatchObject({
        currentSessionId: 'managed-current',
        conversations: managedIndex,
        conversationsStatus: 'ready',
        conversationsDirty: false,
      })
    } finally {
      setActiveAthleteId(null)
      setSelfAthleteId(null)
    }
  })

  it('finishes explicit ids but does not mutate the new scope after a remote delete switch', async () => {
    const {
      bumpSwitchEpoch,
      setActiveAthleteId,
      setSelfAthleteId,
    } = await import('../../services/athlete/activeAthlete')
    const { listConversations } = await import('../../services/chat/conversationIndex')
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    mocks.coachProposals.push({
      id: 'old-proposal',
      chatMessageId: 'old',
      message: 'Propuesta anterior',
      actions: [],
      status: 'pending',
      createdAt: 100,
    })

    let releaseRemoteDelete = () => undefined
    let markRemoteDeleteStarted = () => undefined
    const remoteDeleteStarted = new Promise<void>((resolve) => {
      markRemoteDeleteStarted = resolve
    })
    const remoteDeleteGate = new Promise<void>((resolve) => {
      releaseRemoteDelete = resolve
    })
    mocks.deleteChatMessages.mockImplementationOnce(() => {
      markRemoteDeleteStarted()
      return remoteDeleteGate
    })
    vi.mocked(listConversations).mockClear()

    try {
      const deleting = useChatStore.getState().deleteConversation('old-thread')
      await remoteDeleteStarted

      bumpSwitchEpoch()
      useChatStore.getState().resetForAthleteSwitch()
      setActiveAthleteId('ath_managed')
      const managedIndex: ConversationSummary[] = [{
        sessionId: 'managed-current',
        title: 'Managed',
        lastMessageAt: 2,
        firstMessageAt: 1,
        messageCount: 1,
      }]
      useChatStore.setState({
        currentSessionId: 'managed-current',
        conversations: managedIndex,
        conversationsStatus: 'ready',
        conversationsDirty: false,
      })

      releaseRemoteDelete()
      await deleting

      expect(mocks.deletedMessageIds).toEqual(['old'])
      expect(mocks.deletedProposalIds).toEqual(['old-proposal'])
      expect(mocks.deleteChatMessages).toHaveBeenCalledWith(['old'])
      expect(mocks.deleteCoachProposals).toHaveBeenCalledWith(['old-proposal'])
      expect(mocks.loadProposals).not.toHaveBeenCalled()
      expect(listConversations).not.toHaveBeenCalled()
      expect(useChatStore.getState()).toMatchObject({
        currentSessionId: 'managed-current',
        conversations: managedIndex,
        conversationsStatus: 'ready',
        conversationsDirty: false,
      })
    } finally {
      setActiveAthleteId(null)
      setSelfAthleteId(null)
    }
  })

  it('lets the new athlete hydrate a colliding session while the old delete finishes', async () => {
    const {
      bumpSwitchEpoch,
      setActiveAthleteId,
      setSelfAthleteId,
    } = await import('../../services/athlete/activeAthlete')
    mocks.chatMessages.length = 0
    mocks.chatMessages.push(
      message({
        id: 'self-collision',
        content: 'self',
        chatSessionId: 'colliding-session',
        athleteId: 'ath_self',
      }),
      message({
        id: 'managed-collision',
        content: 'managed',
        chatSessionId: 'colliding-session',
        athleteId: 'ath_managed',
      }),
    )
    mocks.storedSessionId = 'colliding-session'
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    useChatStore.setState({ currentSessionId: 'self-current' })

    let releaseRemoteDelete = () => undefined
    let markRemoteDeleteStarted = () => undefined
    const remoteDeleteStarted = new Promise<void>((resolve) => {
      markRemoteDeleteStarted = resolve
    })
    const remoteDeleteGate = new Promise<void>((resolve) => {
      releaseRemoteDelete = resolve
    })
    mocks.deleteChatMessages.mockImplementationOnce(() => {
      markRemoteDeleteStarted()
      return remoteDeleteGate
    })

    try {
      const deletingSelf = useChatStore.getState().deleteConversation('colliding-session')
      await remoteDeleteStarted

      bumpSwitchEpoch()
      useChatStore.getState().resetForAthleteSwitch()
      setActiveAthleteId('ath_managed')
      useChatStore.setState({ currentSessionId: 'colliding-session' })

      await useChatStore.getState().loadHistory()

      expect(useChatStore.getState().currentSessionId).toBe('colliding-session')
      expect(useChatStore.getState().messages.map(item => item.id))
        .toEqual(['managed-collision'])

      releaseRemoteDelete()
      await deletingSelf
      expect(useChatStore.getState().messages.map(item => item.id))
        .toEqual(['managed-collision'])
    } finally {
      setActiveAthleteId(null)
      setSelfAthleteId(null)
    }
  })
})

describe('hydration racing an in-flight send', () => {
  // El efecto de loadHistory y el de auto-submit desde Plan Builder corren en el
  // mismo commit de React (ChatCoach.tsx:143 y :271), así que una hidratación
  // puede estar en vuelo cuando el envío ya agregó su mensaje optimista.
  it('does not wipe the optimistic message nor kill the spinner', async () => {
    mocks.storedSessionId = 'current-session'
    mocks.localOnly = false
    mocks.chatMessages.push(message({ id: 'existing', timestamp: Date.now() - 1000 }))
    // La request al proveedor no resuelve: representa el envío en vuelo.
    mocks.sendChat.mockImplementation(() => new Promise(() => undefined))

    let releaseRepair = () => undefined
    let markEntered = () => undefined
    const entered = new Promise<void>((resolve) => { markEntered = resolve })
    const gate = new Promise<void>((resolve) => { releaseRepair = resolve })
    mocks.repairPlans.push({ gate, entered: markEntered })

    const hydrating = useChatStore.getState().loadHistory()
    await entered

    void useChatStore.getState().sendMessage('crea mi plan')
    await Promise.resolve()
    await Promise.resolve()

    const optimisticId = useChatStore.getState().messages.at(-1)?.id
    expect(optimisticId).toBeTruthy()
    expect(useChatStore.getState().isLoading).toBe(true)

    releaseRepair()
    await hydrating

    // El envío es dueño de la UI: la hidratación vieja se descarta completa.
    expect(useChatStore.getState().isLoading).toBe(true)
    expect(useChatStore.getState().responsePhase).not.toBe('idle')
    expect(useChatStore.getState().messages.some(item => item.id === optimisticId)).toBe(true)
  })

  it('still hydrates normally when no send is in flight', async () => {
    mocks.storedSessionId = 'current-session'
    mocks.localOnly = false
    mocks.chatMessages.push(message({ id: 'existing', timestamp: Date.now() - 1000 }))

    await useChatStore.getState().loadHistory()

    expect(useChatStore.getState().messages.map(item => item.id)).toEqual(['existing'])
    expect(useChatStore.getState().isLoading).toBe(false)
  })
})
