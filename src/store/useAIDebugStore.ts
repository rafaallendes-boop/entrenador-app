import { create } from 'zustand'
import type { AITechnicalResult } from '../types'

const MAX_DEBUG_REQUESTS = 30

interface AIDebugState {
  requests: AITechnicalResult[]
  startRequest: (entry: Omit<AITechnicalResult, 'status'> & { status?: AITechnicalResult['status'] }) => void
  updateRequest: (traceId: string, patch: Partial<AITechnicalResult>) => void
  markFirstChunk: (traceId: string) => void
  completeRequest: (traceId: string, patch: Partial<AITechnicalResult>) => void
  failRequest: (traceId: string, patch: Partial<AITechnicalResult>) => void
  clear: () => void
}

export const useAIDebugStore = create<AIDebugState>((set) => ({
  requests: [],

  startRequest: (entry) => {
    set((state) => ({
      requests: [
        {
          ...entry,
          status: entry.status ?? 'started',
        },
        ...state.requests,
      ].slice(0, MAX_DEBUG_REQUESTS),
    }))
  },

  updateRequest: (traceId, patch) => {
    set((state) => ({
      requests: state.requests.map((item) => (
        item.traceId === traceId
          ? { ...item, ...patch }
          : item
      )),
    }))
  },

  markFirstChunk: (traceId) => {
    set((state) => ({
      requests: state.requests.map((item) => (
        item.traceId === traceId && item.firstChunkAt == null
          ? { ...item, firstChunkAt: Date.now(), status: 'streaming' }
          : item
      )),
    }))
  },

  completeRequest: (traceId, patch) => {
    set((state) => ({
      requests: state.requests.map((item) => (
        item.traceId === traceId
          ? {
              ...item,
              ...patch,
              completedAt: patch.completedAt ?? Date.now(),
              status: 'completed',
            }
          : item
      )),
    }))
  },

  failRequest: (traceId, patch) => {
    set((state) => ({
      requests: state.requests.map((item) => (
        item.traceId === traceId
          ? {
              ...item,
              ...patch,
              completedAt: patch.completedAt ?? Date.now(),
              status: 'failed',
            }
          : item
      )),
    }))
  },

  clear: () => set({ requests: [] }),
}))
