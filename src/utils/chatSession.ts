import { v4 as uuid } from './uuid'

export const CHAT_SESSION_KEY = 'coach_chat_session_id'
const CHAT_SESSION_LOCAL_ONLY_KEY = 'coach_chat_session_local_only'

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
  const storage = getStorage()
  storage?.setItem(CHAT_SESSION_KEY, id)
  storage?.removeItem(CHAT_SESSION_LOCAL_ONLY_KEY)
}

export function clearStoredChatSessionId(): void {
  const storage = getStorage()
  storage?.removeItem(CHAT_SESSION_KEY)
  storage?.removeItem(CHAT_SESSION_LOCAL_ONLY_KEY)
}

export function isLocalOnlyChatSessionId(id: string): boolean {
  const storage = getStorage()
  return storage?.getItem(CHAT_SESSION_KEY) === id && storage?.getItem(CHAT_SESSION_LOCAL_ONLY_KEY) === '1'
}

export function getOrCreateChatSessionId(): string {
  const existing = getStoredChatSessionId()
  if (existing) return existing

  const id = uuid()
  const storage = getStorage()
  storage?.setItem(CHAT_SESSION_KEY, id)
  storage?.setItem(CHAT_SESSION_LOCAL_ONLY_KEY, '1')
  return id
}
