import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { setAccountRole } from '../../entitlements/accountRoleHolder'
import { backfillLocalAthleteScope } from '../athleteScopeMigration'

function installLocalStorage(): void {
  const state = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return state.size },
      key: (index: number) => Array.from(state.keys())[index] ?? null,
      getItem: (key: string) => state.get(key) ?? null,
      setItem: (key: string, value: string) => { state.set(key, value) },
      removeItem: (key: string) => { state.delete(key) },
      clear: () => { state.clear() },
    },
  })
}

describe('backfillLocalAthleteScope y el rol de cuenta', () => {
  beforeEach(async () => {
    installLocalStorage()
    setAccountRole('unknown')
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    setAccountRole('unknown')
    db.close()
  })

  it('para un coach confirmado no crea self ni membresía y devuelve null', async () => {
    setAccountRole('coach')

    expect(await backfillLocalAthleteScope('coach-1')).toBeNull()
    expect(await db.athletes.count()).toBe(0)
    expect(await db.athleteMemberships.count()).toBe(0)
  })

  it('para athlete (y unknown) crea el self legacy y anticipa su membresía self', async () => {
    setAccountRole('athlete')

    expect(await backfillLocalAthleteScope('user-1')).toBe('ath_user-1')
    expect(await db.athleteMemberships.get(['ath_user-1', 'user-1'])).toMatchObject({ role: 'self' })

    setAccountRole('unknown')
    expect(await backfillLocalAthleteScope('user-2')).toBe('ath_user-2')
  })
})
