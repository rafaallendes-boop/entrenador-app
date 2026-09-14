// Mismo andamiaje que useChatStorePendingIntent.test.ts, pero SIN mockear
// `contextOptimizer`: acá se prueba justamente que store separa dominio (al
// engine) de proyección (al prompt).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, Session } from '../../types'

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

describe('B4 — store: dominio al engine, proyección al prompt', () => {
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

  it('sendAction recibe el dominio completo y una proyección recortada', async () => {
    const sessions = Array.from({ length: 14 }, (_, i) => ({
      id: `sess-${String(i).padStart(2, '0')}`, date: `2099-10-${String(i + 1).padStart(2, '0')}`, weekStartDate: '2099-09-28',
      timeBlock: 'AM', type: 'squash', status: 'planned', title: `Squash ${i}`, durationMin: 60, createdAt: 0, updatedAt: 0,
    })) as Session[]
    mocks.sendAction.mockResolvedValue({ message: 'ok', provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 0, actions: [], meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false } })

    // B4 (Task 13): con el resolver de objetivos real cableado, "squash" +
    // "al martes" volvía esto ambiguo entre las 14 sesiones (todas squash) y
    // producía una aclaración local en vez de llegar a sendAction. El mensaje
    // se acota a algo que el resolver no reconoce como objetivo ("13 de
    // octubre" no es un formato de fecha soportado) para que siga probando lo
    // que este test verifica: dominio completo al engine, proyección al prompt.
    await useChatStore.getState().sendMessage('mueve la sesión del 13 de octubre', {
      recentSessions: sessions, plannedSessions: sessions, historicalSessions: [],
    })

    const [, domain, options] = mocks.sendAction.mock.calls[0]
    expect(domain.plannedSessions).toHaveLength(14)
    expect(options.promptContext.projection).toBe('prompt')
    expect(options.promptContext.plannedSessions.length).toBeLessThanOrEqual(6)
    expect(options.promptContext.sourceCapture.sessions).toHaveLength(14)
  })

  const squashSessions = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: `sess-${String(i).padStart(2, '0')}`, date: `2099-10-${String(i + 1).padStart(2, '0')}`, weekStartDate: '2099-09-28',
    timeBlock: 'AM', type: 'squash', status: 'planned', title: `Squash ${i}`, durationMin: 60, createdAt: 0, updatedAt: 0,
  })) as Session[]
  const proposalFor = (sessions: Session[]) => [{ id: 'old', status: 'pending' as const, createdAt: Date.now() - 1000, message: 'x',
    actions: sessions.map((s) => ({ type: 'move_session' as const, sessionId: s.id, reason: 'r' })) }]

  it('una anáfora sin referente en chat de acción pide aclaración local y abre intención', async () => {
    await useChatStore.getState().sendMessage('borra esa sesión', { recentSessions: [], plannedSessions: [], historicalSessions: [] })
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(mocks.chatMessages.at(-1)?.content).toMatch(/a qué sesión/)
    expect(useChatStore.getState().pendingIntent).toMatchObject({ status: 'open', operation: { type: 'delete_session', missing: ['sessionId'] } })
  })

  it('una cantidad que no coincide pregunta sin ampliar ni abrir intención', async () => {
    const sessions = squashSessions(14)
    await useChatStore.getState().sendMessage('mueve estas ocho sesiones al lunes', {
      recentSessions: sessions, plannedSessions: sessions, historicalSessions: [], recentProposals: proposalFor(sessions),
    })
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(mocks.chatMessages.at(-1)?.content).toContain('Pediste 8')
    expect(useChatStore.getState().pendingIntent).toBeNull()
  })

  it('el exceso se avisa en la respuesta y queda en la metadata', async () => {
    const sessions = squashSessions(14)
    mocks.addProposal.mockResolvedValue({ id: 'p1' })
    mocks.sendAction.mockResolvedValue({ message: 'Listo', provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 0,
      actions: [{ type: 'move_session', sessionId: 'sess-00', targetDate: '2099-11-01', reason: 'r' }],
      meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false } })

    await useChatStore.getState().sendMessage('mueve estas sesiones al lunes', {
      recentSessions: sessions, plannedSessions: sessions, historicalSessions: [], recentProposals: proposalFor(sessions),
    })

    expect(mocks.chatMessages.at(-1)?.content).toContain('quedaron fuera 2')
    expect(mocks.chatMessages.find((m) => m.role === 'user')?.contextMeta).toMatchObject({ targetCount: 12, overflowTargetIds: ['sess-12', 'sess-13'] })
  })

  // Step 7b — regresiones de cardinalidad con el router real (sin mockear el
  // resolver de objetivos). El verbo debe ser uno que `resolveChatRoute`
  // reconozca como mutación ("muévelas" con el clítico pegado no lo es — ver
  // ADJUSTMENT_VERB_PATTERN en chatRouting.ts, que exige "mueve" como palabra
  // completa — así que se usa "quita ... " en su lugar) y que además no
  // coincida con `OPERATION_VERBS.update_session` de pendingIntent.ts, para
  // que una intención `update_session` vieja no la intercepte como reply.

  it('un plural sin referente (sin proveedor mockeado) pregunta local y no abre intención', async () => {
    await useChatStore.getState().sendMessage('quita esas sesiones al viernes', { recentSessions: [], plannedSessions: [], historicalSessions: [] })
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(mocks.sendChat).not.toHaveBeenCalled()
    expect(mocks.chatMessages.at(-1)?.content).toMatch(/a qué sesión/)
    expect(useChatStore.getState().pendingIntent).toBeNull()
  })

  it('una intención singular vieja no consumida se limpia ante un plural sin referente', async () => {
    useChatStore.setState({
      pendingIntent: {
        id: 'stale', kind: 'clarification', athleteId: 'ath_a', conversationId: 'session-1',
        createdAt: Date.now() - 5000, expiresAt: Date.now() + 5 * 60 * 1000, status: 'open', route: 'chat_action',
        operation: { type: 'update_session', known: {}, missing: ['sessionId'] }, summary: 'Ajustar una sesión',
      },
    })
    await useChatStore.getState().sendMessage('quita esas sesiones al viernes', { recentSessions: [], plannedSessions: [], historicalSessions: [] })
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(useChatStore.getState().pendingIntent).toBeNull()
  })

  it('I-1: en chat general el exceso NO se anuncia en la respuesta (aunque igual se resuelvan los objetivos)', async () => {
    // "pesas" solo (sin "sesiones") busca por deporte sobre TODO el contexto
    // (I13 regla 1) y cardinalidad queda 'unspecified': no aclara localmente,
    // resuelve directo con overflow. Con 13 candidatas de fuerza supera el
    // tope de 12 (I13c) igual que el caso de chat_action, pero acá las
    // candidatas son referencia de sólo lectura (I13d) — nada se "procesó".
    const strengthSessions = Array.from({ length: 13 }, (_, i) => ({
      id: `str-${String(i).padStart(2, '0')}`, date: `2099-10-${String(i + 1).padStart(2, '0')}`, weekStartDate: '2099-09-28',
      timeBlock: 'AM', type: 'strength', status: 'planned', title: `Fuerza ${i}`, durationMin: 60, createdAt: 0, updatedAt: 0,
    })) as Session[]
    mocks.sendChat.mockResolvedValue({ message: 'Vas bien con las pesas.', provider: 'mock', traceId: 't', requestClass: 'chat_general', timestamp: 0,
      meta: { hadActionsMarkup: false, actionParseFailed: false, likelyTruncated: false } })

    await useChatStore.getState().sendMessage('¿cómo voy con las pesas?', {
      recentSessions: strengthSessions, plannedSessions: strengthSessions, historicalSessions: [],
    })

    expect(mocks.sendChat).toHaveBeenCalledTimes(1)
    const lastMessage = mocks.chatMessages.at(-1)?.content ?? ''
    expect(lastMessage).not.toMatch(/quedaron fuera/)
    expect(lastMessage).not.toMatch(/Este pedido ten[ií]a más de/)
    expect(lastMessage).toBe('Vas bien con las pesas.')
    // Los objetivos SÍ se resolvieron y viajaron al prompt como referencia —
    // sólo el aviso visible se omite.
    const [, , options] = mocks.sendChat.mock.calls[0]
    expect(options.promptContext.overflowTargets).toHaveLength(1)
  })

  it('catorce objetivos superan el tope: pregunta local sin ampliar ni recortar en silencio', async () => {
    const sessions = squashSessions(14)
    await useChatStore.getState().sendMessage('mueve estas catorce sesiones al lunes', {
      recentSessions: sessions, plannedSessions: sessions, historicalSessions: [], recentProposals: proposalFor(sessions),
    })
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(mocks.addProposal).not.toHaveBeenCalled()
    expect(mocks.chatMessages.at(-1)?.content).toContain('máximo por operación es 12')
    expect(useChatStore.getState().pendingIntent).toBeNull()
  })
})
