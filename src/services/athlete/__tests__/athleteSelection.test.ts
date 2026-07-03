import { describe, it, expect, beforeEach } from 'vitest'
import { getPersistedAthleteSelection, persistAthleteSelection } from '../athleteSelection'

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
}

describe('athleteSelection persistence', () => {
  beforeEach(() => {
    installLocalStorage()
    localStorage.clear()
  })

  it('round-trips a selection per owner', () => {
    persistAthleteSelection('user-1', 'ath_m_1')
    expect(getPersistedAthleteSelection('user-1')).toBe('ath_m_1')
    expect(getPersistedAthleteSelection('user-2')).toBeNull()
  })

  it('null clears the selection', () => {
    persistAthleteSelection('user-1', 'ath_m_1')
    persistAthleteSelection('user-1', null)
    expect(getPersistedAthleteSelection('user-1')).toBeNull()
  })
})
