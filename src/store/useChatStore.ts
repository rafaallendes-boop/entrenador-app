import { create } from 'zustand'
import { db } from '../db/db'
import type { ChatMessage, ChatContext } from '../types'
import { CoachEngine } from '../services/ai/CoachEngine'
import { useCoachActionsStore } from './useCoachActionsStore'
import { v4 as uuid } from '../utils/uuid'
import { AIProviderError } from '../services/ai/types'

interface ChatState {
  messages: ChatMessage[]
  isLoading: boolean
  error: string | null

  loadHistory: () => Promise<void>
  sendMessage: (content: string, context?: ChatContext) => Promise<void>
  clearChat: () => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  error: null,

  loadHistory: async () => {
    const msgs = await db.chatMessages.orderBy('timestamp').toArray()
    set({ messages: msgs })
  },

  sendMessage: async (content, context) => {
    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content,
      timestamp: Date.now(),
      context,
    }
    await db.chatMessages.add(userMsg)
    set(state => ({ messages: [...state.messages, userMsg], isLoading: true, error: null }))

    // Pasamos el historial reciente al context (excluye el mensaje recién añadido)
    const recentMessages = get().messages.slice(-4, -1).map(m => ({ role: m.role, content: m.content }))
    const enrichedContext: ChatContext = {
      ...(context ?? { recentSessions: [] }),
      recentMessages,
    }

    try {
      const response = await CoachEngine.send(content, enrichedContext)

      // If the model returned structured actions, create a proposal automatically
      let proposalId: string | undefined
      if (response.actions && response.actions.length > 0) {
        const proposal = useCoachActionsStore.getState().addProposal(
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
        provider: response.provider,
        proposalId,
      }
      await db.chatMessages.add(coachMsg)
      set(state => ({ messages: [...state.messages, coachMsg], isLoading: false }))
    } catch (e) {
      const errorMsg = formatError(e)
      set({ isLoading: false, error: errorMsg })
    }
  },

  clearChat: async () => {
    await db.chatMessages.clear()
    set({ messages: [], error: null })
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
