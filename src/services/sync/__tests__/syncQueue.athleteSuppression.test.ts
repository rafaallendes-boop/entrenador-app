import { beforeEach, describe, expect, it } from 'vitest'
import type { OfflineOp } from '../../syncUtils'
import { clearQueuedOpsForAthlete, loadQueue, saveQueue } from '../syncQueue'

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
}

function op(partial: Partial<OfflineOp>): OfflineOp {
  return {
    userId: 'user-1',
    table: 'sessions',
    action: 'upsert',
    payload: {},
    enqueuedAt: Date.now(),
    ...partial,
  } as OfflineOp
}

describe('clearQueuedOpsForAthlete', () => {
  beforeEach(() => {
    installLocalStorage()
    localStorage.clear()
  })

  it('elimina ops del atleta pero preserva el delete canonico y ops ajenas', () => {
    saveQueue([
      op({ payload: { id: 's1', athlete_id: 'ath_m_a' } }),
      op({ action: 'session_completion', payload: { p_session_id: 's1' }, scopeAthleteId: 'ath_m_a' }),
      op({ table: 'athletes', action: 'upsert', payload: { id: 'ath_m_a' } }),
      op({ table: 'athletes', action: 'delete', payload: { id: 'ath_m_a' } }),
      op({ payload: { id: 's2', athlete_id: 'ath_m_b' } }),
      op({ userId: 'user-2', payload: { id: 's3', athlete_id: 'ath_m_a' } }),
      op({ action: 'delete', payload: { id: 's-old' } }),
    ])

    clearQueuedOpsForAthlete('user-1', 'ath_m_a')

    const rest = loadQueue()
    expect(rest).toHaveLength(4)
    expect(rest.some((item) => (
      item.table === 'athletes'
      && item.action === 'delete'
      && item.payload.id === 'ath_m_a'
    ))).toBe(true)
    expect(rest.some((item) => item.action === 'session_completion')).toBe(false)
  })

  it('elimina completaciones legacy usando los ids de sesiones del atleta', () => {
    saveQueue([
      op({ action: 'session_completion', payload: { p_session_id: 's-legacy-a' } }),
      op({ action: 'session_completion', payload: { p_session_id: 's-other' } }),
    ])

    clearQueuedOpsForAthlete('user-1', 'ath_m_a', ['s-legacy-a'])

    expect(loadQueue()).toEqual([
      expect.objectContaining({ payload: { p_session_id: 's-other' } }),
    ])
  })
})
