import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getStoredChatSessionId,
  setStoredChatSessionId,
  getOrCreateChatSessionId,
  clearStoredChatSessionId,
  clearAllStoredChatSessionIds,
} from '../chatSession'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'

// Node test env has no localStorage/window: install an in-memory storage
// (same pattern as athleteScopeMigration.test.ts) and alias window→globalThis
// so chatSession's window.localStorage access resolves to it.
function installLocalStorage(): void {
  const state = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return state.size
      },
      key: (index: number) => Array.from(state.keys())[index] ?? null,
      getItem: (key: string) => state.get(key) ?? null,
      setItem: (key: string, value: string) => {
        state.set(key, value)
      },
      removeItem: (key: string) => {
        state.delete(key)
      },
      clear: () => {
        state.clear()
      },
    },
  })
  if (typeof window === 'undefined') {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  }
}

describe('chat session key por atleta', () => {
  beforeEach(() => {
    installLocalStorage()
    localStorage.clear()
  })
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    localStorage.clear()
  })

  it('self activo usa la key legacy (el hilo del owner no se resetea)', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    setStoredChatSessionId('sess-legacy')
    expect(localStorage.getItem('coach_chat_session_id')).toBe('sess-legacy')
    expect(getStoredChatSessionId()).toBe('sess-legacy')
  })

  it('sin atleta activo usa la key legacy', () => {
    setStoredChatSessionId('sess-legacy')
    expect(localStorage.getItem('coach_chat_session_id')).toBe('sess-legacy')
  })

  it('gestionado activo usa una key scoped e independiente', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    setStoredChatSessionId('sess-self')

    setActiveAthleteId('ath_m_1')
    expect(getStoredChatSessionId()).toBeNull() // no hereda el hilo del self
    const managedId = getOrCreateChatSessionId()
    expect(localStorage.getItem('coach_chat_session_id:ath_m_1')).toBe(managedId)

    setActiveAthleteId('ath_self')
    expect(getStoredChatSessionId()).toBe('sess-self') // el hilo del self sigue intacto
  })

  it('clear solo borra la sesión del atleta activo', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    getOrCreateChatSessionId()
    setActiveAthleteId('ath_self')
    setStoredChatSessionId('sess-self')

    setActiveAthleteId('ath_m_1')
    clearStoredChatSessionId()
    expect(localStorage.getItem('coach_chat_session_id:ath_m_1')).toBeNull()
    expect(localStorage.getItem('coach_chat_session_id')).toBe('sess-self')
  })

  it('clearAllStoredChatSessionIds borra keys legacy, scoped y markers local-only', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    getOrCreateChatSessionId() // scoped + marker local-only del gestionado
    setActiveAthleteId('ath_self')
    setStoredChatSessionId('sess-self') // legacy

    clearAllStoredChatSessionIds()
    expect(localStorage.getItem('coach_chat_session_id')).toBeNull()
    expect(localStorage.getItem('coach_chat_session_id:ath_m_1')).toBeNull()
    expect(localStorage.getItem('coach_chat_session_local_only:ath_m_1')).toBeNull()
  })
})
