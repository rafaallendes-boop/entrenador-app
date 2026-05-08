import { create } from 'zustand'
import { db } from '../db/db'
import type { ChatMessage, ChatContext, ChatContextMetadata, AIRequestClass, CoachProposal } from '../types'
import { CoachEngine } from '../services/ai/CoachEngine'
import { optimizeChatContext } from '../services/ai/contextOptimizer'
import { useCoachActionsStore } from './useCoachActionsStore'
import { v4 as uuid } from '../utils/uuid'
import { AIProviderError } from '../services/ai/types'
import type { CoachNormalizedResponse } from '../services/ai/types'
import { getOrCreateChatSessionId, isLocalOnlyChatSessionId, setStoredChatSessionId } from '../utils/chatSession'
import * as syncService from '../services/syncService'
import { useAIDebugStore } from './useAIDebugStore'
import { resolveChatRoute, type ChatRouteKind } from '../services/chatRouting'
import { WeekCreatorEngine } from '../services/weekCreator/WeekCreatorEngine'

let activeChatAbortController: AbortController | null = null
const orphanProposalRepairLocks = new Map<string, Promise<ChatMessage[]>>()

interface ChatState {
  messages: ChatMessage[]
  currentSessionId: string
  isLoading: boolean
  /** Accumulated text from the current streaming response. Empty when not streaming. */
  streamingText: string
  responsePhase: 'idle' | 'connecting' | 'processing' | 'responding'
  error: string | null

  loadHistory: () => Promise<void>
  sendMessage: (content: string, context?: ChatContext) => Promise<{ route: ChatRouteKind }>
  newSession: () => Promise<void>
  deleteCurrentSession: () => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  currentSessionId: getOrCreateChatSessionId(),
  isLoading: false,
  streamingText: '',
  responsePhase: 'idle',
  error: null,

  loadHistory: async () => {
    let sessionId = get().currentSessionId
    let msgs = await db.chatMessages
      .where('chatSessionId')
      .equals(sessionId)
      .sortBy('timestamp')

    if (msgs.length === 0 && isLocalOnlyChatSessionId(sessionId)) {
      const latest = await db.chatMessages.orderBy('timestamp').last()
      if (latest?.chatSessionId) {
        sessionId = latest.chatSessionId
        setStoredChatSessionId(sessionId)
        msgs = await db.chatMessages
          .where('chatSessionId')
          .equals(sessionId)
          .sortBy('timestamp')
        set({ currentSessionId: sessionId })
      }
    }

    const repairedMsgs = await repairOrphanProposalMessages(sessionId, msgs)
    if (sessionId !== get().currentSessionId) return
    set({ messages: repairedMsgs })
  },

  sendMessage: async (content, context) => {
    const route = resolveChatRoute(content, context)
    if (route.kind === 'plan_builder_redirect') {
      return { route: route.kind }
    }

    const sessionId = get().currentSessionId
    // Lock immediately to prevent double-send before the async persist completes.
    if (get().isLoading) return { route: route.kind }
    activeChatAbortController?.abort()
    const abortController = new AbortController()
    activeChatAbortController = abortController
    const requestClass = mapChatRouteToRequestClass(route.kind)
    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content,
      timestamp: Date.now(),
      chatSessionId: sessionId,
      contextMeta: buildChatContextMetadata(context),
    }
    set(state => ({ messages: [...state.messages, userMsg], isLoading: true, streamingText: '', responsePhase: 'connecting', error: null }))
    try {
      await db.chatMessages.add(userMsg)
    } catch {
      set(state => ({
        messages: state.messages.filter(message => message.id !== userMsg.id),
        isLoading: false,
        streamingText: '',
        responsePhase: 'idle',
        error: 'No se pudo guardar el mensaje. Verifica el espacio de almacenamiento.',
      }))
      return { route: route.kind }
    }
    void syncService.pushChatMessage(userMsg)

    // Pasamos historial multi-turno real al provider (excluye el mensaje recién añadido)
    const recentMessages = get().messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
    const enrichedContext = optimizeChatContext({
      ...(context ?? { recentSessions: [], plannedSessions: [], historicalSessions: [] }),
      recentMessages,
    }, requestClass)

    let receivedFirstChunk = false
    const processingTimeout = window.setTimeout(() => {
      if (get().currentSessionId !== sessionId) return
      if (!get().isLoading || receivedFirstChunk) return
      set({ responsePhase: 'processing' })
    }, requestClass === 'chat_general' ? 1000 : 1500)

    // Hard UI watchdog: aborts the provider request and frees the loading state.
    const WATCHDOG_MS = requestClass === 'week_creator' ? 75_000 : 60_000
    let watchdogTimeout: number | undefined
    const watchdogPromise = new Promise<never>((_, reject) => {
      watchdogTimeout = window.setTimeout(() => {
        abortController.abort()
        reject(new Error(`La solicitud tardó demasiado (más de ${Math.round(WATCHDOG_MS / 1000)}s). Intenta de nuevo.`))
      }, WATCHDOG_MS)
    })

    let persistedCoachMsg: ChatMessage | undefined
    let persistedProposalId: string | undefined
    let expectedProposal = false

    try {
      const handleChunk = (chunk: string) => {
        if (!isActiveChatRequest(get().currentSessionId, sessionId, abortController)) return
        receivedFirstChunk = true
        set(state => ({ streamingText: state.streamingText + chunk, responsePhase: 'responding' }))
      }

      const enginePromise: Promise<CoachNormalizedResponse> = route.kind === 'week_creator'
        ? WeekCreatorEngine.sendWeekCreate(content, enrichedContext, {
          surface: 'chat',
          targetWeekStart: route.targetWeekStart ?? enrichedContext.currentWeekSummary?.weekStartDate ?? '',
          signal: abortController.signal,
        })
        : requestClass === 'chat_general'
        ? CoachEngine.sendChat(content, enrichedContext, {
            surface: 'chat',
            onChunk: handleChunk,
            signal: abortController.signal,
          })
        : requestClass === 'chat_action'
          ? CoachEngine.sendAction(content, enrichedContext, {
              surface: 'chat',
              onChunk: handleChunk,
              signal: abortController.signal,
            })
          : CoachEngine.send(content, enrichedContext, {
              requestClass,
              surface: 'chat',
              onChunk: handleChunk,
              signal: abortController.signal,
            })

      const response = await Promise.race([enginePromise, watchdogPromise])
      if (!isActiveChatRequest(get().currentSessionId, sessionId, abortController)) {
        return { route: route.kind }
      }

      const coachMsg = buildCoachMessage(response, sessionId)
      await db.chatMessages.add(coachMsg)
      persistedCoachMsg = coachMsg
      if (!isActiveChatRequest(get().currentSessionId, sessionId, abortController)) {
        await discardLateCoachArtifacts(coachMsg)
        return { route: route.kind }
      }
      void syncService.pushChatMessage(coachMsg)

      let proposalId: string | undefined
      if (shouldCreateProposal(response, requestClass) && isActiveChatRequest(get().currentSessionId, sessionId, abortController)) {
        expectedProposal = true
        const normWarnings = buildNormalizationWarnings(response)
        const proposal = await useCoachActionsStore.getState().addProposal(
          response.message.slice(0, 120) + (response.message.length > 120 ? '…' : ''),
          response.actions ?? [],
          coachMsg.id,
          { source: 'chat', warnings: normWarnings.length > 0 ? normWarnings : undefined },
        )
        proposalId = proposal.id
        persistedProposalId = proposal.id
        if (!isActiveChatRequest(get().currentSessionId, sessionId, abortController)) {
          await discardLateCoachArtifacts(coachMsg, proposalId)
          return { route: route.kind }
        }
        coachMsg.proposalId = proposalId
        await db.chatMessages.update(coachMsg.id, { proposalId })
        void syncService.pushChatMessage(coachMsg)
      }

      useAIDebugStore.getState().completeRequest(response.traceId, {
        proposalCreated: proposalId != null,
      })

      if (!isActiveChatRequest(get().currentSessionId, sessionId, abortController)) {
        await discardLateCoachArtifacts(coachMsg, proposalId)
        return { route: route.kind }
      }
      set(state => ({ messages: [...state.messages, coachMsg], isLoading: false, streamingText: '', responsePhase: 'idle' }))
    } catch (e) {
      if (abortController.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        if (isCurrentChatRequestOwner(get().currentSessionId, sessionId, abortController)) {
          set({ isLoading: false, streamingText: '', responsePhase: 'idle' })
        }
        return { route: route.kind }
      }
      if (expectedProposal && persistedCoachMsg && !persistedProposalId) {
        await discardLateCoachArtifacts(persistedCoachMsg).catch(() => undefined)
      }
      const orphanCoachMsg = expectedProposal && persistedCoachMsg && !persistedProposalId
        ? persistedCoachMsg
        : undefined
      const errorMsg = formatError(e)
      if (get().currentSessionId !== sessionId) return { route: route.kind }
      const coachErrorMsg = route.kind === 'week_creator'
        ? buildCoachErrorMessage(errorMsg, sessionId)
        : undefined
      if (coachErrorMsg) {
        await db.chatMessages.add(coachErrorMsg).catch(() => undefined)
        void syncService.pushChatMessage(coachErrorMsg)
      }
      set(state => ({
        messages: coachErrorMsg
          ? orphanCoachMsg
            ? [...state.messages.filter(message => message.id !== orphanCoachMsg.id), coachErrorMsg]
            : [...state.messages, coachErrorMsg]
          : orphanCoachMsg
            ? state.messages.filter(message => message.id !== orphanCoachMsg.id)
            : state.messages,
        isLoading: false,
        streamingText: '',
        responsePhase: 'idle',
        error: errorMsg,
      }))
    } finally {
      window.clearTimeout(processingTimeout)
      if (watchdogTimeout != null) window.clearTimeout(watchdogTimeout)
      if (activeChatAbortController === abortController) activeChatAbortController = null
    }

    return { route: route.kind }
  },

  newSession: async () => {
    activeChatAbortController?.abort()
    activeChatAbortController = null
    const newId = uuid()
    setStoredChatSessionId(newId)
    set({ currentSessionId: newId, messages: [], isLoading: false, streamingText: '', responsePhase: 'idle', error: null })
  },

  deleteCurrentSession: async () => {
    activeChatAbortController?.abort()
    activeChatAbortController = null
    const sessionId = get().currentSessionId
    const messageIds = await db.chatMessages
      .where('chatSessionId')
      .equals(sessionId)
      .primaryKeys() as string[]

    // Delete proposals linked to any message in this session
    const linkedProposals = await db.coachProposals
      .where('chatMessageId')
      .anyOf(messageIds)
      .toArray()
    const proposalIds = linkedProposals.map(p => p.id)
    if (proposalIds.length > 0) {
      await db.coachProposals.where('chatMessageId').anyOf(messageIds).delete()
      await syncService.deleteCoachProposals(proposalIds)
      await useCoachActionsStore.getState().loadProposals()
    }

    await db.chatMessages.where('chatSessionId').equals(sessionId).delete()
    await syncService.deleteChatMessages(messageIds)
    // After deleting current session, start a new one
    await get().newSession()
  },
}))

function mapChatRouteToRequestClass(route: ChatRouteKind): AIRequestClass {
  switch (route) {
    case 'chat_action':
      return 'chat_action'
    case 'weekly_summary':
      return 'weekly_summary'
    case 'week_creator':
      return 'week_creator'
    case 'chat_general':
    default:
      return 'chat_general'
  }
}
// ─── Response handling (extracted from sendMessage) ───────────────────────────────

function isActiveChatRequest(
  currentSessionId: string,
  expectedSessionId: string,
  abortController: AbortController,
): boolean {
  return isCurrentChatRequestOwner(currentSessionId, expectedSessionId, abortController)
    && !abortController.signal.aborted
}

function isCurrentChatRequestOwner(
  currentSessionId: string,
  expectedSessionId: string,
  abortController: AbortController,
): boolean {
  return activeChatAbortController === abortController
    && currentSessionId === expectedSessionId
}

function shouldCreateProposal(
  response: CoachNormalizedResponse,
  requestClass: AIRequestClass,
): boolean {
  // Skip weekly summaries, chat_general, and truncated responses.
  return (
    requestClass !== 'weekly_summary'
    && requestClass !== 'chat_general'
    && (response.actions?.length ?? 0) > 0
    && !response.meta?.likelyTruncated
  )
}

function buildCoachMessage(
  response: CoachNormalizedResponse,
  chatSessionId: string,
): ChatMessage {
  return {
    id: uuid(),
    role: 'coach',
    content: response.message,
    timestamp: Date.now(),
    chatSessionId,
    provider: response.provider,
    contextMeta: {
      contextVersion: 1,
      traceId: response.traceId,
      likelyTruncated: response.meta?.likelyTruncated === true,
    },
  }
}

function buildCoachErrorMessage(errorMessage: string, chatSessionId: string): ChatMessage {
  return {
    id: uuid(),
    role: 'coach',
    content: `No pude procesar ese pedido.\n\n${errorMessage}\n\nPuedes reintentarlo cuando quieras.`,
    timestamp: Date.now(),
    chatSessionId,
    contextMeta: {
      contextVersion: 1,
      likelyTruncated: false,
    },
  }
}

function buildChatContextMetadata(context?: ChatContext): ChatContextMetadata {
  return {
    contextVersion: 1,
    intent: context?.intent,
    plannedSessionCount: context?.plannedSessions?.length,
    historicalSessionCount: context?.historicalSessions?.length,
    recentSessionCount: context?.recentSessions?.length,
    weekDayLogCount: context?.weekDayLogs?.length,
    hasDayLog: context?.dayLog != null,
    hasAthleteProfile: context?.athleteProfile != null,
    hasAthleteMemory: Boolean(context?.athleteMemory?.trim()),
  }
}

async function discardLateCoachArtifacts(coachMsg: ChatMessage, proposalId?: string): Promise<void> {
  if (proposalId) {
    await db.coachProposals.delete(proposalId)
    void syncService.deleteCoachProposals([proposalId])
    await useCoachActionsStore.getState().loadProposals()
  }
  await db.chatMessages.delete(coachMsg.id)
  void syncService.deleteChatMessages([coachMsg.id])
}

async function repairOrphanProposalMessages(
  chatSessionId: string,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  const existing = orphanProposalRepairLocks.get(chatSessionId)
  if (existing) return existing

  const repairPromise = repairOrphanProposalMessagesUnlocked(chatSessionId, messages)
    .finally(() => {
      orphanProposalRepairLocks.delete(chatSessionId)
    })
  orphanProposalRepairLocks.set(chatSessionId, repairPromise)
  return repairPromise
}

async function repairOrphanProposalMessagesUnlocked(
  chatSessionId: string,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  const repairedForSync: Array<{ message: ChatMessage; proposal: CoachProposal }> = []
  const repairedMessages = await db.transaction('rw', db.chatMessages, db.coachProposals, async () => {
    const proposals = await db.coachProposals.orderBy('createdAt').toArray()
    if (proposals.length === 0 || messages.length === 0) return messages

    const nextMessages = [...messages]
    const messageIds = new Set(nextMessages.map((message) => message.id))
    const linkedProposalIds = new Set(
      nextMessages
        .map((message) => message.proposalId)
        .filter((proposalId): proposalId is string => typeof proposalId === 'string' && proposalId.length > 0),
    )
    const userMessages = nextMessages
      .filter((message) => message.role === 'user')
      .sort((a, b) => a.timestamp - b.timestamp)

    for (const proposal of proposals.sort((a, b) => a.createdAt - b.createdAt)) {
      if (linkedProposalIds.has(proposal.id)) continue
      if (proposal.chatMessageId && messageIds.has(proposal.chatMessageId)) continue

      const anchor = findProposalAnchorMessage(proposal, userMessages)
      if (!anchor) continue
      const hasNearbyCoachReply = nextMessages.some((message) =>
        message.role === 'coach' &&
        message.timestamp >= anchor.timestamp &&
        message.timestamp <= proposal.createdAt + 5 * 60 * 1000
      )
      if (hasNearbyCoachReply) continue

      const repairedMessage = buildProposalRecoveredMessage(proposal, chatSessionId, anchor.timestamp)
      const repairedProposal = { ...proposal, chatMessageId: repairedMessage.id }
      await db.chatMessages.put(repairedMessage)
      await db.coachProposals.put(repairedProposal)

      repairedForSync.push({ message: repairedMessage, proposal: repairedProposal })
      nextMessages.push(repairedMessage)
      messageIds.add(repairedMessage.id)
      linkedProposalIds.add(proposal.id)
    }

    return nextMessages.sort((a, b) => a.timestamp - b.timestamp)
  })

  for (const repaired of repairedForSync) {
    void syncService.pushChatMessage(repaired.message)
    void syncService.pushCoachProposal(repaired.proposal)
  }

  return repairedMessages
}

function findProposalAnchorMessage(
  proposal: CoachProposal,
  userMessages: ChatMessage[],
): ChatMessage | undefined {
  const ORPHAN_REPAIR_WINDOW_MS = 30 * 60 * 1000
  return [...userMessages]
    .reverse()
    .find((message) =>
      message.timestamp <= proposal.createdAt &&
      proposal.createdAt - message.timestamp <= ORPHAN_REPAIR_WINDOW_MS
    )
}

function buildProposalRecoveredMessage(
  proposal: CoachProposal,
  chatSessionId: string,
  anchorTimestamp: number,
): ChatMessage {
  return {
    id: `recovered-proposal-${proposal.id}`,
    role: 'coach',
    content: proposal.message || 'Tengo una propuesta lista para revisar.',
    timestamp: Math.max(anchorTimestamp + 1, proposal.createdAt),
    chatSessionId,
    proposalId: proposal.id,
    contextMeta: {
      contextVersion: 1,
    },
  }
}

// ─── Normalization warnings ────────────────────────────────────────────────────

function buildNormalizationWarnings(response: CoachNormalizedResponse): string[] {
  const warnings: string[] = []
  const diagnostics = response.meta?.createWeekDiagnostics
  if (!diagnostics) return warnings
  for (const diag of diagnostics) {
    if (diag.droppedSessions > 0) {
      warnings.push(
        `${diag.droppedSessions} sesión${diag.droppedSessions > 1 ? 'es' : ''} no pudo generarse por datos incompletos y fue omitida.`,
      )
    }
  }
  return warnings
}

// ─── Error formatting ──────────────────────────────────────────────────────────

function formatError(e: unknown): string {
  if (e instanceof AIProviderError) {
    switch (e.code) {
      case 'unauthorized':
        return 'Tu sesión expiró o no está disponible. Inicia sesión nuevamente e intenta de nuevo.'
      case 'misconfigured':
        return 'El coach no está configurado correctamente en el servidor.'
      case 'rate_limit':
        return `Límite de uso alcanzado en ${e.provider}. Espera unos minutos e intenta de nuevo.`
      case 'timeout':
        return e.message.includes('tardó') || e.message.includes('504') || e.message.includes('502') || e.message.includes('503')
          ? e.message
          : 'Sin conexión con el coach. Verifica tu internet e intenta de nuevo.'
      case 'parse_error':
        return 'El coach devolvió una respuesta inesperada. Intenta de nuevo.'
      default:
        return `Error del coach (${e.provider}): ${e.message}`
    }
  }
  if (e instanceof Error) return e.message
  return 'Error desconocido al conectar con el coach. Intenta de nuevo.'
}
