import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import { clearAllOnboardingSkipped, clearOnboardingSkipped, hasSkippedOnboarding, markOnboardingSkipped } from '../onboarding'

// El env de test (node) no trae localStorage: instalar uno in-memory (mismo
// patrón que chatSession.test.ts).
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

describe('onboarding skip — scope por atleta', () => {
  beforeEach(() => {
    installLocalStorage()
    localStorage.clear()
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
  })

  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('el skip del self NO bloquea el onboarding de un gestionado', () => {
    markOnboardingSkipped('user-1') // self activo → key legacy
    setActiveAthleteId('ath_m_abc') // switch a gestionado
    expect(hasSkippedOnboarding('user-1')).toBe(false)
  })

  it('el skip de un gestionado es propio y se limpia por atleta', () => {
    setActiveAthleteId('ath_m_abc')
    markOnboardingSkipped('user-1')
    expect(hasSkippedOnboarding('user-1')).toBe(true)

    setActiveAthleteId('ath_user-1') // self intacto
    expect(hasSkippedOnboarding('user-1')).toBe(false)

    setActiveAthleteId('ath_m_abc')
    clearOnboardingSkipped('user-1')
    expect(hasSkippedOnboarding('user-1')).toBe(false)
  })

  it('sin atleta activo (legacy) usa la key actual — compat con el flag ya persistido', () => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    localStorage.setItem('entrenador:onboarding:skipped:user-1', '1') // flag pre-2b
    expect(hasSkippedOnboarding('user-1')).toBe(true)
  })

  it('clearAllOnboardingSkipped limpia todos los scopes del usuario', () => {
    markOnboardingSkipped('user-1')
    setActiveAthleteId('ath_m_abc')
    markOnboardingSkipped('user-1')
    localStorage.setItem('entrenador:onboarding:skipped:user-2:ath_m_other', '1')

    clearAllOnboardingSkipped('user-1')

    setActiveAthleteId('ath_user-1')
    expect(hasSkippedOnboarding('user-1')).toBe(false)
    setActiveAthleteId('ath_m_abc')
    expect(hasSkippedOnboarding('user-1')).toBe(false)
    expect(localStorage.getItem('entrenador:onboarding:skipped:user-2:ath_m_other')).toBe('1')
  })
})
