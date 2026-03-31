import { v4 as uuid } from './uuid'

export const CHAT_SESSION_KEY = 'coach_chat_session_id'

export function getStoredChatSessionId(): string | null {
  return localStorage.getItem(CHAT_SESSION_KEY)
}

export function setStoredChatSessionId(id: string): void {
  localStorage.setItem(CHAT_SESSION_KEY, id)
}

export function clearStoredChatSessionId(): void {
  localStorage.removeItem(CHAT_SESSION_KEY)
}

export function getOrCreateChatSessionId(): string {
  const existing = getStoredChatSessionId()
  if (existing) return existing

  const id = uuid()
  setStoredChatSessionId(id)
  return id
}
