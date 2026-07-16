import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: vi.fn(() => null),
  getSelfAthleteId: vi.fn(() => null),
}))

import { CHAT_SESSION_KEY, clearStoredChatSessionIdForAthlete } from '../chatSession'

function installLocalStorage(): void {
  const state = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return state.size },
      clear: () => state.clear(),
      getItem: (key: string) => state.get(key) ?? null,
      key: (index: number) => Array.from(state.keys())[index] ?? null,
      removeItem: (key: string) => state.delete(key),
      setItem: (key: string, value: string) => state.set(key, value),
    },
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
}

describe('clearStoredChatSessionIdForAthlete', () => {
  beforeEach(() => {
    installLocalStorage()
    localStorage.clear()
  })

  it('borra solo las keys sufijadas del atleta pedido', () => {
    localStorage.setItem(CHAT_SESSION_KEY, 'legacy-self')
    localStorage.setItem(`${CHAT_SESSION_KEY}:ath_m_a`, 'chat-a')
    localStorage.setItem('coach_chat_session_local_only:ath_m_a', '1')
    localStorage.setItem(`${CHAT_SESSION_KEY}:ath_m_b`, 'chat-b')

    clearStoredChatSessionIdForAthlete('ath_m_a')

    expect(localStorage.getItem(CHAT_SESSION_KEY)).toBe('legacy-self')
    expect(localStorage.getItem(`${CHAT_SESSION_KEY}:ath_m_a`)).toBeNull()
    expect(localStorage.getItem('coach_chat_session_local_only:ath_m_a')).toBeNull()
    expect(localStorage.getItem(`${CHAT_SESSION_KEY}:ath_m_b`)).toBe('chat-b')
  })
})
