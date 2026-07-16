import { v4 as uuid } from './uuid'
import { getActiveAthleteId, getSelfAthleteId } from '../services/athlete/activeAthlete'

export const CHAT_SESSION_KEY = 'coach_chat_session_id'
const CHAT_SESSION_LOCAL_ONLY_KEY = 'coach_chat_session_local_only'

// Decisión del owner (spec §3.6): la sesión de chat es athlete-scoped por storage
// key. Self o sin atleta activo → keys legacy (compat con el hilo existente del
// owner); atleta gestionado → key sufijada por athleteId.
function chatScopeSuffix(): string {
  const active = getActiveAthleteId()
  if (!active || active === getSelfAthleteId()) return ''
  return `:${active}`
}

function sessionKey(): string {
  return `${CHAT_SESSION_KEY}${chatScopeSuffix()}`
}

function localOnlyKey(): string {
  return `${CHAT_SESSION_LOCAL_ONLY_KEY}${chatScopeSuffix()}`
}

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function getStoredChatSessionId(): string | null {
  return getStorage()?.getItem(sessionKey()) ?? null
}

export function setStoredChatSessionId(id: string): void {
  const storage = getStorage()
  storage?.setItem(sessionKey(), id)
  storage?.removeItem(localOnlyKey())
}

export function clearStoredChatSessionId(): void {
  const storage = getStorage()
  storage?.removeItem(sessionKey())
  storage?.removeItem(localOnlyKey())
}

/**
 * Borra la sesión de un atleta gestionado por id explícito sin tocar las keys
 * legacy del owner, aunque el atleta activo ya haya vuelto al self.
 */
export function clearStoredChatSessionIdForAthlete(athleteId: string): void {
  const storage = getStorage()
  if (!storage) return
  storage.removeItem(`${CHAT_SESSION_KEY}:${athleteId}`)
  storage.removeItem(`${CHAT_SESSION_LOCAL_ONLY_KEY}:${athleteId}`)
}

export function isLocalOnlyChatSessionId(id: string): boolean {
  const storage = getStorage()
  return storage?.getItem(sessionKey()) === id && storage?.getItem(localOnlyKey()) === '1'
}

export function getOrCreateChatSessionId(): string {
  const existing = getStoredChatSessionId()
  if (existing) return existing

  const id = uuid()
  const storage = getStorage()
  storage?.setItem(sessionKey(), id)
  storage?.setItem(localOnlyKey(), '1')
  return id
}

/**
 * Remove EVERY chat session key — legacy and athlete-scoped — plus their
 * local-only markers. For account-global flows (local data reset, backup
 * import) that must not leave stale per-athlete sessions behind.
 */
export function clearAllStoredChatSessionIds(): void {
  const storage = getStorage()
  if (!storage) return
  const doomed: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key) continue
    if (key.startsWith(CHAT_SESSION_KEY) || key.startsWith(CHAT_SESSION_LOCAL_ONLY_KEY)) {
      doomed.push(key)
    }
  }
  doomed.forEach((key) => storage.removeItem(key))
}
