import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { setSelfAthleteId } from '../activeAthlete'
import { resolveAthleteWeekScope, resolveSelfAthleteIdForOwner } from '../athleteWeekScope'

describe('athleteWeekScope', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId(null)
  })

  afterEach(() => {
    setSelfAthleteId(null)
    db.close()
  })

  it('prefiere el holder link-aware cuando está seteado', async () => {
    setSelfAthleteId('ath_claimed_other')
    await expect(resolveSelfAthleteIdForOwner('user-1')).resolves.toBe('ath_claimed_other')
  })

  it('sin holder, resuelve por membresía self', async () => {
    const now = Date.now()
    await db.athleteMemberships.put({
      accountId: 'user-1', athleteId: 'ath_claimed', role: 'self', createdAt: now, updatedAt: now,
    })
    await expect(resolveSelfAthleteIdForOwner('user-1')).resolves.toBe('ath_claimed')
  })

  it('usa el fallback determinístico sin holder ni membresía', async () => {
    await expect(resolveSelfAthleteIdForOwner('user-1')).resolves.toBe('ath_user-1')
  })

  it('incluye legacy solo para el self resuelto', async () => {
    setSelfAthleteId('ath_claimed')
    await expect(resolveAthleteWeekScope('user-1', 'ath_claimed'))
      .resolves.toEqual({ athleteId: 'ath_claimed', includeLegacy: true })
    await expect(resolveAthleteWeekScope('user-1', 'ath_managed'))
      .resolves.toEqual({ athleteId: 'ath_managed', includeLegacy: false })
    await expect(resolveAthleteWeekScope('user-1', 'ath_user-1'))
      .resolves.toEqual({ athleteId: 'ath_user-1', includeLegacy: false })
  })
})
