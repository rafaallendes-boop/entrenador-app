import { create } from 'zustand'
import { db } from '../db/db'
import type { ChatMessage, ChatContext, ChatContextMetadata, AIRequestClass, CoachAction, Session } from '../types'
import { CoachEngine } from '../services/ai/CoachEngine'
import { optimizeChatContext, selectDomainRecentMessages } from '../services/ai/contextOptimizer'
import { useCoachActionsStore } from './useCoachActionsStore'
import { v4 as uuid } from '../utils/uuid'
import { AIProviderError } from '../services/ai/types'
import type { CoachNormalizedResponse } from '../services/ai/types'
import { describeMissing, pendingIntentFromEvents, type PendingIntent } from '../services/chat/pendingIntent'
import {
  resolveMessageTargets,
  describeTargetClarification,
  buildTargetClarificationIntent,
  readOnlyTargetsFromClarification,
  withTargetOverflowNotice,
  type MessageTargetResolution,
} from '../services/chat/messageTargets'
import { getOrCreateChatSessionId, isLocalOnlyChatSessionId, setStoredChatSessionId } from '../utils/chatSession'
import { isRowInActiveScope, filterRowsToActiveScope, withActiveAthleteStamp } from '../services/athlete/activeScopeFilter'
import * as syncService from '../services/syncService'
import { useAIDebugStore } from './useAIDebugStore'
import { resolveChatRoute, mapChatRouteToRequestClass, type ChatRouteKind } from '../services/chatRouting'
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
import { captureRequestScope, isRequestScopeCurrent, type RequestScope } from '../services/athlete/requestScope'
import {
  buildEntitlementDetail,
  toChatEntitlementOffer,
  type EntitlementRequiredDetail,
} from '../services/entitlements/entitlementError'
import { isClassAllowed, minTierForClass } from '../services/entitlements/entitlementPolicy'
import { getEntitlementTier } from './useEntitlementStore'

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
  /** Oferta de plan bajo el hilo. Efimera: no se persiste ni sincroniza. */
  entitlementOffer: EntitlementRequiredDetail | null
  /** Oferta o aclaración a la espera de la próxima respuesta (A4.4). Efímera: no se persiste ni sincroniza. */
  pendingIntent: PendingIntent | null

  loadHistory: () => Promise<void>
  loadConversations: () => Promise<void>
  openConversation: (sessionId: string) => Promise<void>
  sendMessage: (
    content: string,
    context?: ChatContext,
    scope?: RequestScope,
  ) => Promise<{ route: ChatRouteKind; droppedForScopeChange?: boolean }>
  /** Muestra una oferta sin crear una burbuja, una propuesta ni una llamada a IA. */
  showEntitlementOffer: (requestClass: AIRequestClass) => void
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
  entitlementOffer: null,
  pendingIntent: null,

  showEntitlementOffer: (requestClass) => {
    const currentTier = getEntitlementTier()
    const requiredTier = minTierForClass(requestClass)
    if (!requiredTier || isClassAllowed(currentTier, requestClass)) return
    set({
      entitlementOffer: buildEntitlementDetail(requestClass, requiredTier, currentTier),
      error: null,
    })
  },

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

  sendMessage: async (content, context, scope) => {
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
    const requestScope = scope ?? captureRequestScope(get().currentSessionId)
    const intentScope = { athleteId: requestScope.athleteId, conversationId: get().currentSessionId }
    const routeRecentMessages = get().messages.map(m => ({ role: m.role, content: m.content }))
    const routeContext = context
      ? { ...context, recentMessages: context.recentMessages ?? routeRecentMessages }
      : { recentSessions: [], plannedSessions: [], historicalSessions: [], recentMessages: routeRecentMessages }
    const route = resolveChatRoute(content, routeContext, { pendingIntent: get().pendingIntent, scope: intentScope })
    const decision = route.pendingDecision
    // Ninguna rama local puede consumir intención ni persistir mientras otro
    // envío tiene el lock, o si la preparación pertenece a otro atleta.
    if (!isRequestScopeCurrent(requestScope)) return { route: route.kind, droppedForScopeChange: true }
    if (get().isLoading) return { route: route.kind }
    if (decision?.kind === 'already_consumed') {
      await appendLocalCoachMessage(get, set, requestScope, content, 'Esa generación ya quedó en marcha con tu confirmación anterior; no la repito. Si quieres otra, pídemela con el cambio que necesitas.')
      return { route: route.kind }
    }
    if (decision?.kind === 'fill' && get().pendingIntent) {
      const intent = get().pendingIntent!
      // Guardar el avance parcial: lo resuelto y los candidatos quedan en la
      // intención para que el turno siguiente ("PM") parta de ahí.
      set({ pendingIntent: { ...intent, operation: decision.operation } })
      // La fecha va siempre en el candidato, aunque hoy comparta valor entre
      // todos: el horizonte de planificación cubre 2-3 semanas, así que un
      // futuro ensanche de la resolución (título, deporte) puede volver a
      // mezclar fechas distintas bajo el mismo "lunes" y esto ya lo soporta.
      const candidates = decision.candidates.length > 0
        ? ` Ese día tienes: ${decision.candidates.map(c => `${c.title} (${c.date} ${c.timeBlock})`).join(', ')}. Dime cuál.`
        : ''
      await appendLocalCoachMessage(get, set, requestScope, content, `Todavía me falta un dato para ${intent.summary.toLowerCase()}: ${describeMissing(decision.missing)}.${candidates}`)
      return { route: route.kind }
    }
    if (decision?.kind === 'cancel') set({ pendingIntent: null })
    if (route.consumedIntentId) {
      set(state => {
        const intent = state.pendingIntent
        if (!intent || intent.id !== route.consumedIntentId) return {}
        return { pendingIntent: { ...intent, status: 'consumed' as const } }
      })
    } else if (route.kind !== 'chat_general' && get().pendingIntent?.status === 'open') {
      // Empezó otra operación: la oferta anterior deja de estar vigente.
      set({ pendingIntent: null })
    }
    if (route.kind === 'plan_builder_redirect') {
      return { route: route.kind }
    }

    // B4: objetivos del mensaje sobre el dominio. Una intención pendiente ya
    // consumida trae su propio objetivo; no se vuelve a interpretar.
    const rawTargets: MessageTargetResolution = !route.pendingOperation && (route.kind === 'chat_action' || route.kind === 'chat_general')
      ? resolveMessageTargets({
          message: content,
          context: routeContext,
          pendingIntent: get().pendingIntent,
          scope: intentScope,
          recentMessages: get().messages.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
          now: Date.now(),
        })
      : { kind: 'none' }
    // I13d: en chat de acción se aclara localmente, sin IA; nunca se amplía ni se recorta.
    if (rawTargets.kind === 'clarify' && route.kind === 'chat_action') {
      const clarification = buildTargetClarificationIntent(content, rawTargets, intentScope, Date.now())
      set({ pendingIntent: clarification })
      await appendLocalCoachMessage(get, set, requestScope, content, describeTargetClarification(rawTargets))
      return { route: route.kind }
    }
    // En chat general no se interrumpe: las candidatas entran como referencia de lectura.
    const targetResolution = rawTargets.kind === 'clarify' ? readOnlyTargetsFromClarification(rawTargets) : rawTargets

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

    if (!isRequestScopeCurrent(requestScope)) {
      // La operación se inició para otro atleta. No se persiste nada en el
      // scope nuevo; la página conserva el borrador para que el usuario decida.
      return { route: route.kind, droppedForScopeChange: true }
    }

    const userMsg: ChatMessage = withActiveAthleteStamp<ChatMessage>({
      id: uuid(),
      role: 'user',
      content,
      timestamp: Date.now(),
      chatSessionId: sessionId,
      contextMeta: buildChatContextMetadata(context, route.kind, targetResolution),
      athleteId: requestScope.athleteId ?? undefined,
    })
    set(state => ({
      messages: [...state.messages, userMsg],
      isLoading: true,
      streamingText: '',
      responsePhase: 'connecting',
      error: null,
      entitlementOffer: null,
    }))
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

    // B4: dominio completo para postprocesar, validar y resolver objetivos;
    // proyección recortada sólo para el prompt.
    const domainContext: ChatContext = {
      ...(context ?? { recentSessions: [], plannedSessions: [], historicalSessions: [] }),
      recentMessages: selectDomainRecentMessages(get().messages.slice(0, -1), Date.now()),
    }
    const promptContext = optimizeChatContext(domainContext, requestClass, targetResolution)

    if (route.pendingOperation && route.pendingOperation.type !== 'create_week') {
      const resolvedSessionId = typeof route.pendingOperation.known.sessionId === 'string'
        ? route.pendingOperation.known.sessionId
        : undefined
      const sourceSession = resolvedSessionId
        ? (domainContext.plannedSessions ?? []).find(s => s.id === resolvedSessionId)
        : undefined
      const local = buildDeterministicActionFromOperation(route.pendingOperation, sourceSession)
      if (local) {
        // move_session / delete_session con todos sus datos: no hace falta IA.
        // Se crea la PROPUESTA (nunca se aplica): la tarjeta sigue siendo la aceptación.
        // Misma disciplina que la ruta con IA: comprobar scope Y conversación
        // después de CADA await, y deshacer lo escrito si cambió. `addProposal`
        // estampa con el atleta activo del momento, así que sin esta
        // comprobación mensaje y propuesta podrían quedar en scopes distintos.
        const stillOwns = () => isRequestScopeCurrent(requestScope) && isActiveChatRequest(get().currentSessionId, sessionId, abortController)
        // El atleta pudo cambiar sin que el hilo/sesión cambiara: la UI sigue
        // siendo dueña de ese spinner aunque el contenido no se publique.
        const releaseLoadingIfStillOwner = () => {
          if (isCurrentChatRequestOwner(get().currentSessionId, sessionId, abortController)) {
            set({ isLoading: false, streamingText: '', responsePhase: 'idle' })
          }
        }
        if (!stillOwns()) { releaseLoadingIfStillOwner(); return { route: route.kind, droppedForScopeChange: true } }
        const coachMsg = buildCoachMessage({ ...emptyNormalizedResponse('chat_action'), message: local.message }, sessionId)
        await db.chatMessages.add(coachMsg)
        if (!stillOwns()) { await discardLateCoachArtifacts(coachMsg); releaseLoadingIfStillOwner(); return { route: route.kind, droppedForScopeChange: true } }
        const proposal = await useCoachActionsStore.getState().addProposal(local.message, [local.action], coachMsg.id, { source: 'chat' })
        if (!stillOwns()) { await discardLateCoachArtifacts(coachMsg, proposal.id); releaseLoadingIfStillOwner(); return { route: route.kind, droppedForScopeChange: true } }
        coachMsg.proposalId = proposal.id
        await db.chatMessages.update(coachMsg.id, { proposalId: proposal.id })
        if (!stillOwns()) { await discardLateCoachArtifacts(coachMsg, proposal.id); releaseLoadingIfStillOwner(); return { route: route.kind, droppedForScopeChange: true } }
        void syncService.pushChatMessage(coachMsg)
        set(state => ({ messages: [...state.messages, coachMsg], isLoading: false, streamingText: '', responsePhase: 'idle', conversationsDirty: true }))
        return { route: route.kind }
      }
      // update_session / add_session: necesitan IA. La operación viaja en el contexto
      // como dato estructurado, no como texto libre.
      domainContext.pendingOperation = route.pendingOperation
      promptContext.pendingOperation = route.pendingOperation
    }

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
        ? WeekCreatorEngine.sendWeekCreate(content, domainContext, {
          surface: 'chat',
          targetWeekStart: route.targetWeekStart ?? domainContext.currentWeekSummary?.weekStartDate ?? '',
          generationId: weekCreatorGenerationId,
          signal: abortController.signal,
          targetAthleteId: requestScope.athleteId,
          promptContext,
        })
        : requestClass === 'chat_general'
        ? CoachEngine.sendChat(content, domainContext, {
            surface: 'chat',
            onChunk: handleChunk,
            signal: abortController.signal,
            targetAthleteId: requestScope.athleteId,
            promptContext,
          })
        : requestClass === 'chat_action'
          ? CoachEngine.sendAction(content, domainContext, {
              surface: 'chat',
              onChunk: handleChunk,
              signal: abortController.signal,
              targetAthleteId: requestScope.athleteId,
              promptContext,
            })
          : CoachEngine.send(content, domainContext, {
              requestClass,
              surface: 'chat',
              onChunk: handleChunk,
              signal: abortController.signal,
              targetAthleteId: requestScope.athleteId,
              promptContext,
            })

      const rawResponse = await Promise.race([enginePromise, watchdogPromise])
      // I13d: en chat general las candidatas son referencia de sólo lectura —
      // no se "procesó" nada, así que el aviso de desborde (redactado para
      // chat_action) no aplica ahí.
      const response = route.kind === 'chat_action'
        ? withTargetOverflowNotice(rawResponse, promptContext.overflowTargets)
        : rawResponse
      if (!isRequestScopeCurrent(requestScope) || !isActiveChatRequest(get().currentSessionId, sessionId, abortController)) {
        return { route: route.kind }
      }
      const currentTier = getEntitlementTier()
      const weekCreatorRequiredTier = minTierForClass('week_creator') ?? 'advanced'
      const entitlementOffer = response.filteredCreateWeek
        && !isClassAllowed(currentTier, 'week_creator')
        ? buildEntitlementDetail('week_creator', weekCreatorRequiredTier, currentTier)
        : null

      if (!isRequestScopeCurrent(requestScope)) {
        // El atleta activo cambió mientras el proveedor respondía. El texto
        // pertenece al atleta original: no se persiste en el scope nuevo.
        if (isCurrentChatRequestOwner(get().currentSessionId, sessionId, abortController)) {
          set({ isLoading: false, streamingText: '', responsePhase: 'idle' })
        }
        return { route: route.kind }
      }

      const coachMsg = buildCoachMessage(response, sessionId)
      await db.chatMessages.add(coachMsg)
      set({ conversationsDirty: true })
      persistedCoachMsg = coachMsg
      if (!isRequestScopeCurrent(requestScope) || !isActiveChatRequest(get().currentSessionId, sessionId, abortController)) {
        await discardLateCoachArtifacts(coachMsg)
        return { route: route.kind }
      }
      // La intención pertenece a esta conversación/atleta: si cambiaron durante
      // el `await` de arriba, no se le atribuye a la que quedó visible.
      if (isRequestScopeCurrent(requestScope)) {
        const nextIntent = pendingIntentFromEvents(response.conversationEvents, intentScope, Date.now())
        if (nextIntent) set({ pendingIntent: nextIntent })
      }
      void syncService.pushChatMessage(coachMsg)

      let proposalId: string | undefined
      if (
        shouldCreateProposal(response, requestClass)
        && isActiveChatRequest(get().currentSessionId, sessionId, abortController)
        && isRequestScopeCurrent(requestScope)
      ) {
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
        if (!isRequestScopeCurrent(requestScope) || !isActiveChatRequest(get().currentSessionId, sessionId, abortController)) {
          await discardLateCoachArtifacts(coachMsg, proposalId)
          return { route: route.kind }
        }
        coachMsg.proposalId = proposalId
        await db.chatMessages.update(coachMsg.id, { proposalId })
        void syncService.pushChatMessage(coachMsg)
      }

      const proposalReadyAt = Date.now()
      const safelyDeclined = requestClass === 'week_creator'
        && response.meta?.outcome === 'safety_blocked'
      const weekCreatorFailed = requestClass === 'week_creator' && proposalId == null && !safelyDeclined
      const terminalPatch = {
        proposalCreated: proposalId != null,
        endToEndDurationMs: proposalReadyAt - requestStartedAt,
        ...(weekCreatorFailed ? {} : { proposalReadyAt }),
        ...(requestClass === 'week_creator'
          ? {
              generationOutcome: weekCreatorFailed
                ? 'failed' as const
                : safelyDeclined
                  ? 'safe_decline' as const
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

      if (!isRequestScopeCurrent(requestScope) || !isActiveChatRequest(get().currentSessionId, sessionId, abortController)) {
        await discardLateCoachArtifacts(coachMsg, proposalId)
        return { route: route.kind }
      }
      set(state => ({
        messages: [...state.messages, coachMsg],
        isLoading: false,
        streamingText: '',
        responsePhase: 'idle',
        entitlementOffer,
      }))
    } catch (e) {
      if (!isRequestScopeCurrent(requestScope)) {
        if (persistedCoachMsg) await discardLateCoachArtifacts(persistedCoachMsg, persistedProposalId)
        return { route: route.kind, droppedForScopeChange: true }
      }
      if (!abortedByWatchdog && (abortController.signal.aborted || (e instanceof DOMException && e.name === 'AbortError'))) {
        if (isCurrentChatRequestOwner(get().currentSessionId, sessionId, abortController)) {
          set({ isLoading: false, streamingText: '', responsePhase: 'idle' })
        }
        return { route: route.kind }
      }

      const entitlementOffer = toChatEntitlementOffer(e)
      if (entitlementOffer) {
        // La oferta pertenece al request que la produjo. Un switch de hilo o
        // atleta aborta/libera su controller, por lo que una respuesta tardía
        // no puede publicar metadata en el scope que quedó visible.
        if (!isRequestScopeCurrent(requestScope) || !isActiveChatRequest(get().currentSessionId, sessionId, abortController)) {
          return { route: route.kind }
        }
        if (weekCreatorGenerationId) {
          markWeekCreatorGenerationFailed(weekCreatorGenerationId, requestStartedAt)
        }
        // Es una oferta, no un error de conversación: no se crea ni persiste
        // una burbuja del coach y tampoco se expone el texto crudo del 403.
        set({
          entitlementOffer,
          isLoading: false,
          streamingText: '',
          responsePhase: 'idle',
          error: null,
        })
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
        if (!isRequestScopeCurrent(requestScope) || !isCurrentChatRequestOwner(get().currentSessionId, sessionId, abortController)) {
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
      if (isCurrentChatRequestOwner(get().currentSessionId, sessionId, abortController)) {
        set({ isLoading: false, streamingText: '', responsePhase: 'idle' })
      }
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
      entitlementOffer: null,
      pendingIntent: null,
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
    entitlementOffer: null,
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
    entitlementOffer: null,
    rotationSuspended: false,
    conversationsDirty: true,
  })
  return newId
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

function buildChatContextMetadata(context?: ChatContext, route?: ChatRouteKind, targets?: MessageTargetResolution): ChatContextMetadata {
  return {
    contextVersion: route ? 2 : 1,
    intent: context?.intent,
    route,
    plannedSessionCount: context?.plannedSessions?.length,
    historicalSessionCount: context?.historicalSessions?.length,
    recentSessionCount: context?.recentSessions?.length,
    weekDayLogCount: context?.weekDayLogs?.length,
    hasDayLog: context?.dayLog != null,
    hasAthleteProfile: context?.athleteProfile != null,
    hasAthleteMemory: Boolean(context?.athleteMemory?.trim()),
    ...(targets?.kind === 'resolved'
      ? { targetCount: targets.targets.length, ...(targets.overflow.length > 0 ? { overflowTargetIds: targets.overflow.map((t) => t.sessionId) } : {}) }
      : {}),
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

// ─── Intención pendiente (A4.4) ─────────────────────────────────────────────────

/**
 * `move_session`/`delete_session` con todos sus datos resueltos no necesitan
 * IA: la operación ya es determinista. `update_session`/`add_session` siguen
 * necesitando al modelo (contenido no trivial) y `null` los deja seguir por
 * ese camino.
 */
function buildDeterministicActionFromOperation(
  op: Exclude<PendingIntent['operation'], { type: 'create_week' }>,
  // Sesión de origen resuelta contra `plannedSessions` en el call site. Sin
  // esto, un referente ambiguo entre semanas ("la del lunes" con 2-3 lunes en
  // el horizonte) queda invisible en la tarjeta: sólo se veía la fecha
  // DESTINO, nunca cuál sesión concreta se iba a mover — un match a la semana
  // equivocada no tenía forma de detectarse antes de aceptar.
  sourceSession?: Pick<Session, 'date' | 'timeBlock' | 'title'>,
): { action: CoachAction; message: string } | null {
  const sessionId = typeof op.known.sessionId === 'string' ? op.known.sessionId : undefined
  const targetDate = typeof op.known.targetDate === 'string' ? op.known.targetDate : undefined
  const sessionLabel = sourceSession
    ? `la sesión "${sourceSession.title}" del ${sourceSession.date} (${sourceSession.timeBlock})`
    : 'esa sesión'
  if (op.type === 'move_session' && sessionId && targetDate) {
    return { action: { type: 'move_session', sessionId, targetDate, reason: 'Confirmado por el atleta en el chat.' }, message: `Propongo mover ${sessionLabel} al ${targetDate}. Revisa y aplica cuando quieras.` }
  }
  if (op.type === 'delete_session' && sessionId) {
    return { action: { type: 'delete_session', sessionId, reason: 'Confirmado por el atleta en el chat.' }, message: `Propongo eliminar ${sessionLabel}. Revisa y aplica cuando quieras.` }
  }
  return null
}

function emptyNormalizedResponse(requestClass: AIRequestClass): CoachNormalizedResponse {
  return { message: '', provider: 'mock', traceId: `local-${uuid()}`, requestClass, timestamp: Date.now(), filteredCreateWeek: false }
}

/** Turno local completo, con las mismas garantías de scope y de conversación. */
async function appendLocalCoachMessage(
  get: () => ChatState,
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  requestScope: RequestScope,
  userContent: string,
  content: string,
): Promise<void> {
  const sessionId = get().currentSessionId
  const owns = () => isRequestScopeCurrent(requestScope) && sessionId === get().currentSessionId
  if (!owns()) return
  const userMessage = withActiveAthleteStamp<ChatMessage>({
    id: uuid(), role: 'user', content: userContent, timestamp: Date.now(), chatSessionId: sessionId,
    contextMeta: buildChatContextMetadata(undefined, 'chat_general'),
  })
  const message = withActiveAthleteStamp<ChatMessage>({
    id: uuid(), role: 'coach', content, timestamp: Date.now(), chatSessionId: sessionId, provider: 'mock',
  })
  set({ isLoading: true })
  try {
    await db.chatMessages.add(userMessage)
    if (!owns()) { await db.chatMessages.delete(userMessage.id); return }
    await db.chatMessages.add(message)
    if (!owns()) {
      await db.chatMessages.delete(userMessage.id)
      await db.chatMessages.delete(message.id)
      return
    }
    void syncService.pushChatMessage(userMessage)
    void syncService.pushChatMessage(message)
    set(state => ({ messages: [...state.messages, userMessage, message], conversationsDirty: true }))
  } catch {
    await db.chatMessages.delete(userMessage.id)
    await db.chatMessages.delete(message.id)
    if (owns()) set({ error: 'No se pudo guardar el mensaje. Verifica el espacio de almacenamiento.' })
  } finally {
    if (sessionId === get().currentSessionId) set({ isLoading: false })
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

export function formatError(e: unknown): string {
  if (e instanceof AIProviderError) {
    switch (e.code) {
      case 'unauthorized':
        return 'Tu sesión expiró o no está disponible. Inicia sesión nuevamente e intenta de nuevo.'
      case 'misconfigured':
        return 'RallyIQ no está configurado correctamente en el servidor.'
      case 'entitlement_required':
        return 'Esta función está en un plan superior. Mirá los planes disponibles.'
      // Rol/membresía: el mensaje del servidor ya explica la causa real y
      // ningún plan la resuelve, así que no se reemplaza por copy de upsell.
      case 'coach_access_required':
        return e.message
      case 'quota_exceeded':
        return 'Alcanzaste el cupo diario de esta función. Vuelve a intentarlo mañana.'
      case 'spend_cap_exceeded':
        return 'El servicio alcanzó su presupuesto diario. Vuelve a intentarlo mañana.'
      case 'kill_switch_active':
        return 'La IA está temporalmente pausada. Volvé a intentarlo más tarde.'
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
