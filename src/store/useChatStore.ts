import { create } from 'zustand'
import { db } from '../db/db'
import type { ChatMessage, ChatContext, ChatContextMetadata, AIRequestClass } from '../types'
import { CoachEngine } from '../services/ai/CoachEngine'
import { optimizeChatContext } from '../services/ai/contextOptimizer'
import { useCoachActionsStore } from './useCoachActionsStore'
import { v4 as uuid } from '../utils/uuid'
import { AIProviderError } from '../services/ai/types'
import type { CoachNormalizedResponse } from '../services/ai/types'
import { getOrCreateChatSessionId, isLocalOnlyChatSessionId, setStoredChatSessionId } from '../utils/chatSession'
import { isRowInActiveScope, filterRowsToActiveScope, withActiveAthleteStamp } from '../services/athlete/activeScopeFilter'
import * as syncService from '../services/syncService'
import { useAIDebugStore } from './useAIDebugStore'
import { resolveChatRoute, type ChatRouteKind } from '../services/chatRouting'
import { WeekCreatorEngine } from '../services/weekCreator/WeekCreatorEngine'
import { buildAIGenerationId } from '../services/ai/requestPolicy'
import { shouldRotateConversation } from '../services/chat/dailyRotation'
import { listConversations, type ConversationSummary } from '../services/chat/conversationIndex'
import { repairOrphanProposalMessages } from '../services/chat/orphanProposalRepair'
import {
  getActiveAthleteId,
  getSelfAthleteId,
  getSwitchEpoch,
} from '../services/athlete/activeAthlete'

let activeChatAbortController: AbortController | null = null
let latestHistoryLoadRequestId = 0
let latestConversationsLoadRequestId = 0
const conversationMutationEpochs = new Map<string, number>()
const activeConversationDeleteCounts = new Map<string, number>()

interface ChatAthleteScopeSnapshot {
  activeAthleteId: string | null
  selfAthleteId: string | null
}

interface ChatState {
  messages: ChatMessage[]
  currentSessionId: string
  isLoading: boolean
  /** Accumulated text from the current streaming response. Empty when not streaming. */
  streamingText: string
  responsePhase: 'idle' | 'connecting' | 'processing' | 'responding'
  error: string | null
  conversations: ConversationSummary[]
  conversationsStatus: 'idle' | 'loading' | 'ready' | 'error'
  conversationsDirty: boolean
  rotationSuspended: boolean

  loadHistory: () => Promise<void>
  loadConversations: () => Promise<void>
  openConversation: (sessionId: string) => Promise<void>
  sendMessage: (content: string, context?: ChatContext) => Promise<{ route: ChatRouteKind }>
  newSession: () => Promise<void>
  deleteConversation: (sessionId: string) => Promise<void>
  deleteCurrentSession: () => Promise<void>
  resetForAthleteSwitch: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  currentSessionId: getOrCreateChatSessionId(),
  isLoading: false,
  streamingText: '',
  responsePhase: 'idle',
  error: null,
  conversations: [],
  conversationsStatus: 'idle',
  conversationsDirty: true,
  rotationSuspended: false,

  loadHistory: async () => {
    const requestId = ++latestHistoryLoadRequestId
    // El store vive entre remounts. Entrar de nuevo al chat reactiva la regla
    // diaria aunque antes se haya abierto explícitamente un hilo antiguo.
    set({ rotationSuspended: false })

    // La key de sesión es athlete-scoped: re-resolverla en cada load para que un
    // cambio de atleta (remount) no arrastre el hilo del atleta anterior.
    const resolvedSessionId = getOrCreateChatSessionId()
    const resolvedMutationKey = buildConversationMutationKey(
      resolvedSessionId,
      captureChatAthleteScope(),
    )

    // No persistir acá: setStoredChatSessionId borra el marcador local-only que
    // habilita la adopción de un hilo ya existente.
    let loaded = false
    try {
      loaded = await loadSession(resolvedSessionId, {
        requestId,
        mutationKey: resolvedMutationKey,
        sessionEpoch: getConversationMutationEpoch(resolvedMutationKey),
        persistId: false,
        suspendRotation: false,
      })
    } catch {
      if (requestId === latestHistoryLoadRequestId) {
        set({
          isLoading: false,
          streamingText: '',
          responsePhase: 'idle',
          error: 'No se pudo cargar la conversación.',
        })
      }
    }
    if (!loaded) return

    if (get().messages.length === 0 && isLocalOnlyChatSessionId(resolvedSessionId)) {
      // Una fila huérfana sin chatSessionId no debe bloquear un hilo válido.
      const latest = await db.chatMessages
        .orderBy('timestamp')
        .reverse()
        .filter((message) =>
          isRowInActiveScope(message.athleteId) && Boolean(message.chatSessionId)
        )
        .first()
      if (requestId !== latestHistoryLoadRequestId) return
      if (
        latest?.chatSessionId &&
        !shouldRotateConversation(latest.timestamp, Date.now())
      ) {
        const adoptedMutationKey = buildConversationMutationKey(
          latest.chatSessionId,
          captureChatAthleteScope(),
        )
        const adoptedSessionEpoch = getConversationMutationEpoch(adoptedMutationKey)
        await loadSession(latest.chatSessionId, {
          requestId,
          mutationKey: adoptedMutationKey,
          sessionEpoch: adoptedSessionEpoch,
          persistId: true,
          suspendRotation: false,
        })
        return
      }
    }

    const messages = get().messages
    const lastAt = messages.length > 0
      ? messages[messages.length - 1].timestamp
      : null
    if (shouldRotateConversation(lastAt, Date.now())) startFreshSessionSync()
  },

  openConversation: async (sessionId) => {
    const mutationKey = buildConversationMutationKey(
      sessionId,
      captureChatAthleteScope(),
    )
    // Un hilo en borrado no participa de la carrera de aperturas: rechazarlo
    // antes de tomar el token evita cancelar una apertura válida de otro hilo.
    if (isConversationDeleteActive(mutationKey)) {
      set({ error: 'Esa conversación se está eliminando.' })
      return
    }
    // Adquirir la propiedad antes de validar evita que una apertura lenta gane a
    // un segundo toque que ya terminó.
    const requestId = ++latestHistoryLoadRequestId
    const sessionEpoch = getConversationMutationEpoch(mutationKey)
    let rows: ChatMessage[]
    try {
      rows = filterRowsToActiveScope(
        await db.chatMessages.where('chatSessionId').equals(sessionId).toArray(),
      )
    } catch {
      if (requestId === latestHistoryLoadRequestId) {
        set(state => ({
          error: 'No se pudo cargar la conversación.',
          ...(state.isLoading && activeChatAbortController == null
            ? {
                isLoading: false,
                streamingText: '',
                responsePhase: 'idle' as const,
              }
            : {}),
        }))
      }
      return
    }
    if (requestId !== latestHistoryLoadRequestId) return
    if (!isConversationEpochCurrent(mutationKey, sessionEpoch)) {
      clearOrphanedLoadingForHistoryOwner(requestId)
      return
    }
    if (rows.length === 0) {
      // Una validación inválida no debe abortar una request que sigue viva.
      // Pero si otra apertura ya la abortó/liberó y luego perdió el token,
      // isLoading quedó huérfano y este dueño vigente tiene que limpiarlo.
      set(state => ({
        error: 'No encontramos esa conversación.',
        ...(state.isLoading && activeChatAbortController == null
          ? {
              isLoading: false,
              streamingText: '',
              responsePhase: 'idle' as const,
            }
          : {}),
      }))
      return
    }

    try {
      const loaded = await loadSession(sessionId, {
        requestId,
        mutationKey,
        sessionEpoch,
        persistId: true,
        suspendRotation: true,
      })
      if (!loaded) clearOrphanedLoadingForHistoryOwner(requestId)
    } catch {
      if (requestId === latestHistoryLoadRequestId) {
        set({
          isLoading: false,
          streamingText: '',
          responsePhase: 'idle',
          error: 'No se pudo cargar la conversación.',
        })
      }
    }
  },

  loadConversations: async () => {
    const requestId = ++latestConversationsLoadRequestId
    set({ conversationsStatus: 'loading' })
    try {
      const conversations = await listConversations()
      if (requestId !== latestConversationsLoadRequestId) return
      set({
        conversations,
        conversationsStatus: 'ready',
        conversationsDirty: false,
      })
    } catch {
      if (requestId !== latestConversationsLoadRequestId) return
      // Conservar el último índice válido; el próximo drawer debe reintentar.
      set({ conversationsStatus: 'error', conversationsDirty: true })
    }
  },

  sendMessage: async (content, context) => {
    // Debe suceder antes de las DOS derivaciones de historial (routing y
    // proveedor). No hay await antes de adquirir el lock de isLoading.
    if (!get().isLoading && !get().rotationSuspended) {
      const current = get().messages
      const lastAt = current.length > 0
        ? current[current.length - 1].timestamp
        : null
      if (shouldRotateConversation(lastAt, Date.now())) startFreshSessionSync()
    }
    const requestStartedAt = Date.now()
    const routeRecentMessages = get().messages.map(m => ({ role: m.role, content: m.content }))
    const routeContext = context
      ? { ...context, recentMessages: context.recentMessages ?? routeRecentMessages }
      : { recentSessions: [], plannedSessions: [], historicalSessions: [], recentMessages: routeRecentMessages }
    const route = resolveChatRoute(content, routeContext)
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
    const weekCreatorGenerationId = requestClass === 'week_creator'
      ? buildAIGenerationId('week_creator')
      : undefined
    const userMsg: ChatMessage = withActiveAthleteStamp<ChatMessage>({
      id: uuid(),
      role: 'user',
      content,
      timestamp: Date.now(),
      chatSessionId: sessionId,
      contextMeta: buildChatContextMetadata(context),
    })
    set(state => ({ messages: [...state.messages, userMsg], isLoading: true, streamingText: '', responsePhase: 'connecting', error: null }))
    try {
      await db.chatMessages.add(userMsg)
      set({ conversationsDirty: true })
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
    const recentMessages = get().messages.slice(0, -1).map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp }))
    const enrichedContext = optimizeChatContext({
      ...(context ?? { recentSessions: [], plannedSessions: [], historicalSessions: [] }),
      recentMessages,
    }, requestClass)

    let receivedFirstChunk = false
    let rawStreamingText = ''
    const processingTimeout = window.setTimeout(() => {
      if (get().currentSessionId !== sessionId) return
      if (!get().isLoading || receivedFirstChunk) return
      set({ responsePhase: 'processing' })
    }, requestClass === 'chat_general' ? 1000 : 1500)

    // Hard UI watchdog: aborts the provider request and frees the loading state.
    const WATCHDOG_MS = requestClass === 'week_creator' ? 75_000 : 60_000
    let watchdogTimeout: number | undefined
    let abortedByWatchdog = false
    const watchdogErrorMessage = `La solicitud tardó demasiado (más de ${Math.round(WATCHDOG_MS / 1000)}s). Intenta de nuevo.`
    const watchdogPromise = new Promise<never>((_, reject) => {
      watchdogTimeout = window.setTimeout(() => {
        abortedByWatchdog = true
        abortController.abort()
        reject(new Error(watchdogErrorMessage))
      }, WATCHDOG_MS)
    })

    let persistedCoachMsg: ChatMessage | undefined
    let persistedProposalId: string | undefined
    let expectedProposal = false
    try {
      const handleChunk = (chunk: string) => {
        if (!isActiveChatRequest(get().currentSessionId, sessionId, abortController)) return
        receivedFirstChunk = true
        rawStreamingText += chunk
        set({
          streamingText: getVisibleCoachStreamText(rawStreamingText, requestClass),
          responsePhase: 'responding',
        })
      }

      const enginePromise: Promise<CoachNormalizedResponse> = route.kind === 'week_creator'
        ? WeekCreatorEngine.sendWeekCreate(content, enrichedContext, {
          surface: 'chat',
          targetWeekStart: route.targetWeekStart ?? enrichedContext.currentWeekSummary?.weekStartDate ?? '',
          generationId: weekCreatorGenerationId,
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
      set({ conversationsDirty: true })
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

      const proposalReadyAt = Date.now()
      const weekCreatorFailed = requestClass === 'week_creator' && proposalId == null
      const terminalPatch = {
        proposalCreated: proposalId != null,
        endToEndDurationMs: proposalReadyAt - requestStartedAt,
        ...(weekCreatorFailed ? {} : { proposalReadyAt }),
        ...(requestClass === 'week_creator'
          ? {
              generationOutcome: weekCreatorFailed
                ? 'failed' as const
                : response.fallbackUsed ? 'local_fallback' as const : 'model_success' as const,
              generationCompletedAt: proposalReadyAt,
            }
          : {}),
      }
      if (weekCreatorFailed) {
        useAIDebugStore.getState().failRequest(response.traceId, terminalPatch)
      } else {
        useAIDebugStore.getState().completeRequest(response.traceId, terminalPatch)
      }

      if (!isActiveChatRequest(get().currentSessionId, sessionId, abortController)) {
        await discardLateCoachArtifacts(coachMsg, proposalId)
        return { route: route.kind }
      }
      set(state => ({ messages: [...state.messages, coachMsg], isLoading: false, streamingText: '', responsePhase: 'idle' }))
    } catch (e) {
      if (!abortedByWatchdog && (abortController.signal.aborted || (e instanceof DOMException && e.name === 'AbortError'))) {
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
      const errorMsg = abortedByWatchdog ? watchdogErrorMessage : formatError(e)
      if (weekCreatorGenerationId) {
        markWeekCreatorGenerationFailed(weekCreatorGenerationId, requestStartedAt)
      }
      if (get().currentSessionId !== sessionId) return { route: route.kind }
      const coachErrorMsg = route.kind === 'week_creator'
        ? buildCoachErrorMessage(errorMsg, sessionId)
        : undefined
      if (coachErrorMsg) {
        const persisted = await db.chatMessages.add(coachErrorMsg)
          .then(() => true)
          .catch(() => false)
        // Cambiar de conversación aborta y libera el controller. Si ocurrió
        // mientras Dexie persistía el error, no se lo puede anexar al hilo
        // recién abierto.
        if (!isCurrentChatRequestOwner(get().currentSessionId, sessionId, abortController)) {
          if (persisted) await discardLateCoachArtifacts(coachErrorMsg)
          return { route: route.kind }
        }
        if (persisted) {
          void syncService.pushChatMessage(coachErrorMsg)
          set({ conversationsDirty: true })
        }
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
    startFreshSessionSync()
  },

  deleteConversation: async (sessionId) => {
    const switchEpochAtStart = getSwitchEpoch()
    const athleteScopeIsCurrent = () => getSwitchEpoch() === switchEpochAtStart
    const mutationKey = buildConversationMutationKey(
      sessionId,
      captureChatAthleteScope(),
    )
    // El epoch invalida hidrataciones previas del MISMO hilo sin cancelar una
    // apertura legítima de otro. El contador mantiene el guard correcto aunque
    // dos borrados del mismo id se solapen.
    beginConversationDelete(mutationKey)
    try {
      if (sessionId === get().currentSessionId) {
        activeChatAbortController?.abort()
        activeChatAbortController = null
      }
      // Borrar SOLO mensajes del scope activo: un thread puede contener filas de
      // otro atleta (import, estado viejo, colisión de session id). Se derivan los
      // ids desde la lista filtrada y se borra por ids, nunca por chatSessionId.
      const sessionMessages = filterRowsToActiveScope(
        await db.chatMessages
          .where('chatSessionId')
          .equals(sessionId)
          .toArray(),
      )
      // El filtro consulta el scope global: si cambió mientras Dexie leía, no
      // se puede confiar en esos rows ni derivar ids destructivos desde ellos.
      if (!athleteScopeIsCurrent()) return
      const messageIds = sessionMessages.map((message) => message.id)

      // Delete proposals linked to any in-scope message in this session
      const linkedProposals = messageIds.length > 0
        ? await db.coachProposals
            .where('chatMessageId')
            .anyOf(messageIds)
            .toArray()
        : []
      // Hasta acá no empezó ningún delete. Un switch permite abortar con cero
      // efectos locales o remotos.
      if (!athleteScopeIsCurrent()) return
      const proposalIds = linkedProposals.map(p => p.id)
      if (proposalIds.length > 0) {
        await db.coachProposals.bulkDelete(proposalIds)
        await syncService.deleteCoachProposals(proposalIds)
      }

      // Desde el primer bulkDelete los ids ya quedaron scope-filtrados bajo A.
      // Aunque cambie el atleta, completar SOLO esos ids explícitos evita dejar
      // el borrado a medias; ninguna lectura o mutación de stores usa el scope B.
      await db.chatMessages.bulkDelete(messageIds)
      await syncService.deleteChatMessages(messageIds)
      if (!athleteScopeIsCurrent()) return

      if (proposalIds.length > 0) {
        await useCoachActionsStore.getState().loadProposals()
        if (!athleteScopeIsCurrent()) return
      }
      set({ conversationsDirty: true })

      // Re-chequear tras los await: el usuario pudo abrir otro hilo mientras se
      // eliminaba el que antes era actual.
      if (get().currentSessionId === sessionId) {
        await get().newSession()
        if (!athleteScopeIsCurrent()) return
      }
      if (!athleteScopeIsCurrent()) return
      await get().loadConversations()
    } finally {
      endConversationDelete(mutationKey)
    }
  },

  deleteCurrentSession: async () => {
    await get().deleteConversation(get().currentSessionId)
  },

  resetForAthleteSwitch: () => {
    activeChatAbortController?.abort()
    activeChatAbortController = null
    latestHistoryLoadRequestId += 1
    latestConversationsLoadRequestId += 1
    set({
      messages: [],
      isLoading: false,
      streamingText: '',
      responsePhase: 'idle',
      error: null,
      conversations: [],
      conversationsStatus: 'idle',
      conversationsDirty: true,
      rotationSuspended: false,
    })
  },
}))

export function getVisibleCoachStreamText(
  rawText: string,
  requestClass: AIRequestClass,
): string {
  if (requestClass !== 'chat_action') return rawText

  const trimmedStart = rawText.trimStart()
  if (trimmedStart.startsWith('{') || trimmedStart.startsWith('[')) return ''

  const actionsTagIndex = rawText.toLowerCase().indexOf('<actions')
  if (actionsTagIndex >= 0) return rawText.slice(0, actionsTagIndex).trimEnd()

  const inlineActions = rawText.match(
    /(?:^|\n)\s*(?:```json\s*)?(?:\{\s*"actions"\s*:|\[\s*\{\s*"type"\s*:)/i,
  )
  if (inlineActions?.index != null) {
    return rawText.slice(0, inlineActions.index).trimEnd()
  }

  // Hold a marker fragment split across network chunks so "<act" never flashes
  // as user-visible content before the next chunk completes "<actions>".
  const marker = '<actions'
  const lower = rawText.toLowerCase()
  for (let length = marker.length - 1; length > 0; length -= 1) {
    if (lower.endsWith(marker.slice(0, length))) {
      return rawText.slice(0, -length).trimEnd()
    }
  }
  return rawText
}

function captureChatAthleteScope(): ChatAthleteScopeSnapshot {
  return {
    activeAthleteId: getActiveAthleteId(),
    selfAthleteId: getSelfAthleteId(),
  }
}

function buildConversationMutationKey(
  sessionId: string,
  scope: ChatAthleteScopeSnapshot,
): string {
  return JSON.stringify([
    sessionId,
    scope.activeAthleteId,
    scope.selfAthleteId,
  ])
}

function getConversationMutationEpoch(mutationKey: string): number {
  return conversationMutationEpochs.get(mutationKey) ?? 0
}

function isConversationDeleteActive(mutationKey: string): boolean {
  return (activeConversationDeleteCounts.get(mutationKey) ?? 0) > 0
}

function isConversationEpochCurrent(mutationKey: string, expectedEpoch: number): boolean {
  return !isConversationDeleteActive(mutationKey)
    && getConversationMutationEpoch(mutationKey) === expectedEpoch
}

function beginConversationDelete(mutationKey: string): void {
  conversationMutationEpochs.set(
    mutationKey,
    getConversationMutationEpoch(mutationKey) + 1,
  )
  activeConversationDeleteCounts.set(
    mutationKey,
    (activeConversationDeleteCounts.get(mutationKey) ?? 0) + 1,
  )
}

function endConversationDelete(mutationKey: string): void {
  const remaining = (activeConversationDeleteCounts.get(mutationKey) ?? 1) - 1
  if (remaining <= 0) {
    activeConversationDeleteCounts.delete(mutationKey)
    return
  }
  activeConversationDeleteCounts.set(mutationKey, remaining)
}

function clearOrphanedLoadingForHistoryOwner(requestId: number): void {
  if (
    requestId !== latestHistoryLoadRequestId ||
    activeChatAbortController != null
  ) {
    return
  }
  const state = useChatStore.getState()
  if (!state.isLoading) return
  useChatStore.setState({
    isLoading: false,
    streamingText: '',
    responsePhase: 'idle',
  })
}

async function loadSession(
  sessionId: string,
  options: {
    requestId: number
    mutationKey: string
    sessionEpoch: number
    persistId: boolean
    suspendRotation: boolean
  },
): Promise<boolean> {
  const {
    requestId,
    mutationKey,
    sessionEpoch,
    persistId,
    suspendRotation,
  } = options
  if (!isConversationEpochCurrent(mutationKey, sessionEpoch)) return false

  activeChatAbortController?.abort()
  activeChatAbortController = null

  const rows = filterRowsToActiveScope(
    await db.chatMessages
      .where('chatSessionId')
      .equals(sessionId)
      .sortBy('timestamp'),
  )
  if (requestId !== latestHistoryLoadRequestId) return false
  if (!isConversationEpochCurrent(mutationKey, sessionEpoch)) return false

  const repaired = await repairOrphanProposalMessages(sessionId, rows)
  if (requestId !== latestHistoryLoadRequestId) return false
  if (!isConversationEpochCurrent(mutationKey, sessionEpoch)) return false
  // Esta carga anuló el controller al empezar y `sendMessage` es el único que
  // asigna uno nuevo: encontrarlo no nulo significa que un envío arrancó durante
  // nuestros await. El snapshot ya es viejo —no contiene el mensaje optimista— y
  // commitearlo borraría el turno del usuario y apagaría su spinner con la
  // request todavía viva. El envío es dueño de la UI: esta carga se descarta.
  // Reproducible desde el mount: el efecto de loadHistory y el de auto-submit de
  // Plan Builder corren en el mismo commit de React (ChatCoach.tsx:143 y :271).
  if (activeChatAbortController != null) return false

  // Commit final único: desde la persistencia no vuelve a haber ningún await.
  if (persistId) setStoredChatSessionId(sessionId)
  useChatStore.setState({
    currentSessionId: sessionId,
    messages: repaired,
    isLoading: false,
    streamingText: '',
    responsePhase: 'idle',
    error: null,
    ...(suspendRotation ? { rotationSuspended: true } : {}),
    ...(repaired.length > rows.length ? { conversationsDirty: true } : {}),
  })
  return true
}

/**
 * El cambio usado por sendMessage tiene que ser síncrono. Esperar a
 * newSession() cedería el turno antes de que sendMessage adquiera isLoading.
 */
function startFreshSessionSync(): string {
  activeChatAbortController?.abort()
  activeChatAbortController = null
  // Una hidratación anterior no puede reinstalar su hilo después de que el
  // usuario (o la rotación diaria) decidió empezar uno nuevo.
  latestHistoryLoadRequestId += 1
  const newId = uuid()
  setStoredChatSessionId(newId)
  useChatStore.setState({
    currentSessionId: newId,
    messages: [],
    isLoading: false,
    streamingText: '',
    responsePhase: 'idle',
    error: null,
    rotationSuspended: false,
    conversationsDirty: true,
  })
  return newId
}

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
  return withActiveAthleteStamp<ChatMessage>({
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
  })
}

function buildCoachErrorMessage(errorMessage: string, chatSessionId: string): ChatMessage {
  const message = errorMessage.trim() || 'No pude crear la semana esta vez.'
  return withActiveAthleteStamp<ChatMessage>({
    id: uuid(),
    role: 'coach',
    content: `${message}\n\nPuedes ajustar tu disponibilidad o reintentarlo cuando quieras.`,
    timestamp: Date.now(),
    chatSessionId,
    contextMeta: {
      contextVersion: 1,
      likelyTruncated: false,
    },
  })
}

function markWeekCreatorGenerationFailed(generationId: string, requestStartedAt: number): void {
  const terminalRequest = useAIDebugStore.getState().requests
    .find((request) => request.generationId === generationId)
  if (!terminalRequest) return
  const generationCompletedAt = Date.now()
  useAIDebugStore.getState().failRequest(terminalRequest.traceId, {
    proposalCreated: false,
    endToEndDurationMs: generationCompletedAt - requestStartedAt,
    generationOutcome: 'failed',
    generationCompletedAt,
  })
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
        return 'RallyIQ no está configurado correctamente en el servidor.'
      case 'rate_limit':
        if (e.message.includes('Límite diario')) return e.message
        return `Límite de uso alcanzado en ${e.provider}. Espera unos minutos e intenta de nuevo.`
      case 'timeout':
        return e.message.includes('tardó') || e.message.includes('504') || e.message.includes('502') || e.message.includes('503')
          ? e.message
          : 'Sin conexión con RallyIQ. Verifica tu internet e intenta de nuevo.'
      case 'parse_error':
        return 'RallyIQ devolvió una respuesta inesperada. Intenta de nuevo.'
      default:
        return `Error de RallyIQ (${e.provider}): ${e.message}`
    }
  }
  if (e instanceof Error) return e.message
  return 'Error desconocido al conectar con RallyIQ. Intenta de nuevo.'
}
