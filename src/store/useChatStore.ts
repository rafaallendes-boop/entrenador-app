import { create } from 'zustand'
import { db } from '../db/db'
import type { ChatMessage, ChatContext } from '../types'
import { CoachEngine } from '../services/ai/CoachEngine'
import { inferRequestClassFromIntent, optimizeChatContext } from '../services/ai/contextOptimizer'
import { useCoachActionsStore } from './useCoachActionsStore'
import { v4 as uuid } from '../utils/uuid'
import { AIProviderError } from '../services/ai/types'
import { getOrCreateChatSessionId, setStoredChatSessionId } from '../utils/chatSession'
import * as syncService from '../services/syncService'
import { useAIDebugStore } from './useAIDebugStore'

interface ChatState {
  messages: ChatMessage[]
  currentSessionId: string
  isLoading: boolean
  /** Accumulated text from the current streaming response. Empty when not streaming. */
  streamingText: string
  responsePhase: 'idle' | 'connecting' | 'processing' | 'responding'
  error: string | null

  loadHistory: () => Promise<void>
  sendMessage: (content: string, context?: ChatContext) => Promise<void>
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
    const sessionId = get().currentSessionId
    const msgs = await db.chatMessages
      .where('chatSessionId')
      .equals(sessionId)
      .sortBy('timestamp')
    if (sessionId !== get().currentSessionId) return
    set({ messages: msgs })
  },

  sendMessage: async (content, context) => {
    const sessionId = get().currentSessionId
    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content,
      timestamp: Date.now(),
      chatSessionId: sessionId,
      context,
    }
    await db.chatMessages.add(userMsg)
    void syncService.pushChatMessage(userMsg)
    const requestClass = inferRequestClassFromIntent(context?.intent)
    const shouldStreamResponse = !(requestClass === 'chat_action' && context?.intent === 'plan_week')
    set(state => ({ messages: [...state.messages, userMsg], isLoading: true, streamingText: '', responsePhase: 'connecting', error: null }))

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
    }, 1500)

    try {
      const response = await CoachEngine.send(content, enrichedContext, {
        requestClass,
        surface: 'chat',
        onChunk: shouldStreamResponse
          ? (chunk) => {
              if (get().currentSessionId !== sessionId) return
              receivedFirstChunk = true
              set(state => ({ streamingText: state.streamingText + chunk, responsePhase: 'responding' }))
            }
          : undefined,
      })
      if (get().currentSessionId !== sessionId) {
        return
      }

      // If the model returned structured actions, create a proposal automatically.
      // Skip weekly summaries and likely truncated responses to avoid partial or unwanted proposals.
      let proposalId: string | undefined
      if (
        requestClass !== 'weekly_summary'
        && response.actions
        && response.actions.length > 0
        && !response.meta?.likelyTruncated
      ) {
        const proposal = await useCoachActionsStore.getState().addProposal(
          response.message.slice(0, 120) + (response.message.length > 120 ? '…' : ''),
          response.actions,
          undefined,
          { source: 'chat' },
        )
        proposalId = proposal.id
      }
      useAIDebugStore.getState().completeRequest(response.traceId, {
        proposalCreated: proposalId != null,
      })

      const coachMsg: ChatMessage = {
        id: uuid(),
        role: 'coach',
        content: response.message,
        timestamp: Date.now(),
        chatSessionId: sessionId,
        provider: response.provider,
        proposalId,
      }
      await db.chatMessages.add(coachMsg)
      void syncService.pushChatMessage(coachMsg)
      if (get().currentSessionId !== sessionId) return
      set(state => ({ messages: [...state.messages, coachMsg], isLoading: false, streamingText: '', responsePhase: 'idle' }))
    } catch (e) {
      const errorMsg = formatError(e)
      if (get().currentSessionId !== sessionId) return
      set({ isLoading: false, streamingText: '', responsePhase: 'idle', error: errorMsg })
    } finally {
      window.clearTimeout(processingTimeout)
    }
  },

  newSession: async () => {
    const newId = uuid()
    setStoredChatSessionId(newId)
    set({ currentSessionId: newId, messages: [], isLoading: false, streamingText: '', responsePhase: 'idle', error: null })
  },

  deleteCurrentSession: async () => {
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

// ─── Error formatting ──────────────────────────────────────────────────────────

function formatError(e: unknown): string {
  if (e instanceof AIProviderError) {
    switch (e.code) {
      case 'unauthorized':
        return `API key inválida o no configurada (${e.provider}). Verifica tu .env.`
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
