import { create } from 'zustand'
import type { AITechnicalResult } from '../types'

const MAX_DEBUG_REQUESTS = 30
const AI_DEBUG_STORAGE_KEY = 'entrenador_ai_debug_requests_v1'

interface AIDebugState {
  requests: AITechnicalResult[]
  startRequest: (entry: Omit<AITechnicalResult, 'status'> & { status?: AITechnicalResult['status'] }) => void
  updateRequest: (traceId: string, patch: Partial<AITechnicalResult>) => void
  markFirstChunk: (traceId: string) => void
  completeRequest: (traceId: string, patch: Partial<AITechnicalResult>) => void
  failRequest: (traceId: string, patch: Partial<AITechnicalResult>) => void
  clear: () => void
}

function loadPersistedRequests(): AITechnicalResult[] {
  try {
    if (typeof sessionStorage === 'undefined') return []
    const raw = sessionStorage.getItem(AI_DEBUG_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is AITechnicalResult => Boolean(
        item &&
        typeof item === 'object' &&
        typeof (item as Partial<AITechnicalResult>).traceId === 'string' &&
        typeof (item as Partial<AITechnicalResult>).requestClass === 'string',
      ))
      .slice(0, MAX_DEBUG_REQUESTS)
  } catch {
    return []
  }
}

function persistRequests(requests: AITechnicalResult[]): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem(AI_DEBUG_STORAGE_KEY, JSON.stringify(requests.slice(0, MAX_DEBUG_REQUESTS)))
  } catch {
    // Debug data is best-effort.
  }
}

function commitRequests(next: AITechnicalResult[]): { requests: AITechnicalResult[] } {
  const requests = next.slice(0, MAX_DEBUG_REQUESTS)
  persistRequests(requests)
  return { requests }
}

export const useAIDebugStore = create<AIDebugState>((set) => ({
  requests: loadPersistedRequests(),

  startRequest: (entry) => {
    set((state) => commitRequests([
        {
          ...entry,
          status: entry.status ?? 'started',
        },
        ...state.requests,
      ]))
  },

  updateRequest: (traceId, patch) => {
    set((state) => commitRequests(state.requests.map((item) => (
        item.traceId === traceId
          ? { ...item, ...patch }
          : item
      ))))
  },

  markFirstChunk: (traceId) => {
    set((state) => commitRequests(state.requests.map((item) => (
        item.traceId === traceId && item.firstChunkAt == null
          ? { ...item, firstChunkAt: Date.now(), status: 'streaming' }
          : item
      ))))
  },

  completeRequest: (traceId, patch) => {
    set((state) => commitRequests(state.requests.map((item) => (
        item.traceId === traceId
          ? {
              ...item,
              ...patch,
              completedAt: patch.completedAt ?? Date.now(),
              status: 'completed',
            }
          : item
      ))))
  },

  failRequest: (traceId, patch) => {
    set((state) => commitRequests(state.requests.map((item) => (
        item.traceId === traceId
          ? {
              ...item,
              ...patch,
              completedAt: patch.completedAt ?? Date.now(),
              status: 'failed',
            }
          : item
      ))))
  },

  clear: () => set(commitRequests([])),
}))
