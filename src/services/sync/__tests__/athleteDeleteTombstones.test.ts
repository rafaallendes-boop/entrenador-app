import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ATHLETE_DELETE_TOMBSTONE_PREFIX,
  clearAllAthleteDeleteTombstones,
  clearAthleteDeleteTombstone,
  hasAthleteDeleteTombstone,
  hasAthleteDeleteTombstoneForAthlete,
  rememberAthleteDeleteTombstone,
} from '../athleteDeleteTombstones'

class MemoryStorage implements Storage {
  private readonly state = new Map<string, string>()

  get length(): number { return this.state.size }
  clear(): void { this.state.clear() }
  getItem(key: string): string | null { return this.state.get(key) ?? null }
  key(index: number): string | null { return Array.from(this.state.keys())[index] ?? null }
  removeItem(key: string): void { this.state.delete(key) }
  setItem(key: string, value: string): void { this.state.set(key, value) }
}

function installLocalStorage(): void {
  Object.defineProperty(globalThis, 'Storage', { configurable: true, value: MemoryStorage })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
}

describe('athleteDeleteTombstones', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installLocalStorage()
    localStorage.clear()
    clearAllAthleteDeleteTombstones()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('remember + has por user y atleta, con key por intento', () => {
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(false)
    const token = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
    expect(hasAthleteDeleteTombstone('user-2', 'ath_m_a')).toBe(false)
    expect(localStorage.getItem(`${ATHLETE_DELETE_TOMBSTONE_PREFIX}:user-1:ath_m_a:${token}`)).toBeTruthy()
  })

  it('cada intento crea su key y devuelve un token distinto', () => {
    const tokenA = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    const tokenB = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    expect(tokenA).not.toBe(tokenB)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
  })

  it('el rollback de B no retira el tombstone del delete activo de A', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    const tokenB = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    expect(clearAthleteDeleteTombstone('user-1', 'ath_m_a', tokenB)).toBe(true)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
  })

  it('hasAthleteDeleteTombstoneForAthlete ignora el userId', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    expect(hasAthleteDeleteTombstoneForAthlete('ath_m_a')).toBe(true)
    expect(hasAthleteDeleteTombstoneForAthlete('ath_m_b')).toBe(false)
  })

  it('reutiliza el índice durable sin enumerar localStorage en cada lookup', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    const keySpy = vi.spyOn(Storage.prototype, 'key')

    for (let index = 0; index < 100; index += 1) {
      expect(hasAthleteDeleteTombstoneForAthlete('ath_m_a')).toBe(true)
      expect(hasAthleteDeleteTombstoneForAthlete('ath_missing')).toBe(false)
    }

    expect(keySpy).not.toHaveBeenCalled()
  })

  it('clear retira solo la key de su intento y atleta', () => {
    const tokenA = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    rememberAthleteDeleteTombstone('user-1', 'ath_m_b')
    expect(clearAthleteDeleteTombstone('user-1', 'ath_m_a', tokenA)).toBe(true)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(false)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_b')).toBe(true)
  })

  it('remember lanza si el storage no persiste por error', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => rememberAthleteDeleteTombstone('user-1', 'ath_m_a')).toThrow()
  })

  it('remember lanza si el read-back no devuelve el valor', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
    expect(() => rememberAthleteDeleteTombstone('user-1', 'ath_m_a')).toThrow()
  })

  it('clear con token inexistente devuelve false sin tocar nada', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    expect(clearAthleteDeleteTombstone('user-1', 'ath_m_a', 'token-ajeno')).toBe(false)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
  })

  it('clear devuelve false si removeItem falla silenciosamente', () => {
    const token = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {})
    expect(clearAthleteDeleteTombstone('user-1', 'ath_m_a', token)).toBe(false)
  })

  it('clear devuelve false si la lectura de verificacion falla y conserva el espejo', () => {
    const token = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(clearAthleteDeleteTombstone('user-1', 'ath_m_a', token)).toBe(false)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
  })

  it('con storage ilegible, has sigue viendo tombstones de esta sesion', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
    expect(hasAthleteDeleteTombstoneForAthlete('ath_m_a')).toBe(true)
  })

  it('clearAll elimina keys y espejo verificados', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    rememberAthleteDeleteTombstone('user-2', 'ath_m_b')
    expect(clearAllAthleteDeleteTombstones()).toBe(true)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(false)
    expect(hasAthleteDeleteTombstoneForAthlete('ath_m_b')).toBe(false)
  })

  it('clearAll conserva el espejo de lo que no pudo verificar', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {})
    expect(clearAllAthleteDeleteTombstones()).toBe(false)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).some(
      (key) => key?.startsWith(`${ATHLETE_DELETE_TOMBSTONE_PREFIX}:user-1:ath_m_a:`),
    )).toBe(true)
  })
})
