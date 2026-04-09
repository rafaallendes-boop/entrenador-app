import { v4 as uuid } from './uuid'

export const CHAT_SESSION_KEY = 'coach_chat_session_id'

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function getStoredChatSessionId(): string | null {
  return getStorage()?.getItem(CHAT_SESSION_KEY) ?? null
}

export function setStoredChatSessionId(id: string): void {
  getStorage()?.setItem(CHAT_SESSION_KEY, id)
}

export function clearStoredChatSessionId(): void {
  getStorage()?.removeItem(CHAT_SESSION_KEY)
}

export function getOrCreateChatSessionId(): string {
  const existing = getStoredChatSessionId()
  if (existing) return existing

  const id = uuid()
  setStoredChatSessionId(id)
  return id
}
