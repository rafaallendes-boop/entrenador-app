import { create } from 'zustand'
import { db } from '../db/db'
import type { ChatMessage, ChatContext } from '../types'
import { CoachEngine } from '../services/ai/CoachEngine'
import { optimizeChatContext } from '../services/ai/contextOptimizer'
import { useCoachActionsStore } from './useCoachActionsStore'
import { v4 as uuid } from '../utils/uuid'
import { AIProviderError } from '../services/ai/types'
import { getOrCreateChatSessionId, setStoredChatSessionId } from '../utils/chatSession'
import * as syncService from '../services/syncService'

interface ChatState {
  messages: ChatMessage[]
  currentSessionId: string
  isLoading: boolean
  /** Accumulated text from the current streaming response. Empty when not streaming. */
  streamingText: string
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
  error: null,

  loadHistory: async () => {
    const sessionId = get().currentSessionId
    const msgs = await db.chatMessages
      .where('chatSessionId')
      .equals(sessionId)
      .sortBy('timestamp')
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
    set(state => ({ messages: [...state.messages, userMsg], isLoading: true, streamingText: '', error: null }))

    // Pasamos historial multi-turno real al provider (excluye el mensaje recién añadido)
    const recentMessages = get().messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
    const enrichedContext = optimizeChatContext({
      ...(context ?? { recentSessions: [] }),
      recentMessages,
    })

    try {
      const response = await CoachEngine.send(content, enrichedContext, {
        onChunk: (chunk) => set(state => ({ streamingText: state.streamingText + chunk })),
      })

      // If the model returned structured actions, create a proposal automatically
      let proposalId: string | undefined
      if (response.actions && response.actions.length > 0) {
        const proposal = await useCoachActionsStore.getState().addProposal(
          response.message.slice(0, 120) + (response.message.length > 120 ? '…' : ''),
          response.actions,
        )
        proposalId = proposal.id
      }

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
      set(state => ({ messages: [...state.messages, coachMsg], isLoading: false, streamingText: '' }))
    } catch (e) {
      const errorMsg = formatError(e)
      set({ isLoading: false, streamingText: '', error: errorMsg })
    }
  },

  newSession: async () => {
    const newId = uuid()
    setStoredChatSessionId(newId)
    set({ currentSessionId: newId, messages: [], error: null })
  },

  deleteCurrentSession: async () => {
    const sessionId = get().currentSessionId
    const messageIds = await db.chatMessages
      .where('chatSessionId')
      .equals(sessionId)
      .primaryKeys() as string[]

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
        return 'Sin conexión con el coach. Verifica tu internet e intenta de nuevo.'
      case 'parse_error':
        return 'El coach devolvió una respuesta inesperada. Intenta de nuevo.'
      default:
        return `Error del coach (${e.provider}): ${e.message}`
    }
  }
  if (e instanceof Error) return e.message
  return 'Error desconocido al conectar con el coach. Intenta de nuevo.'
}
