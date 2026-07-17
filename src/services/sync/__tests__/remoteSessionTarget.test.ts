import { describe, expect, it } from 'vitest'
import type { Session } from '../../../types'
import { captureRemoteSessionTarget, isRemoteSessionTarget } from '../remoteSessionTarget'

const row = (athleteId?: string) => ({ id: 's', athleteId } as Session)

describe('remoteSessionTarget', () => {
  it('captura una fila scoped', () => {
    expect(captureRemoteSessionTarget(row('ath_m'), 'owner', 'ath_self'))
      .toEqual({ kind: 'scoped', athleteId: 'ath_m' })
  })

  it('captura una fila legacy contra el self resuelto', () => {
    expect(captureRemoteSessionTarget(row(), 'owner', 'ath_self'))
      .toEqual({ kind: 'legacySelf', ownerAccountId: 'owner', selfAthleteId: 'ath_self' })
  })

  it('valida targets deserializados', () => {
    expect(isRemoteSessionTarget({ kind: 'scoped', athleteId: 'ath' })).toBe(true)
    expect(isRemoteSessionTarget({ kind: 'legacySelf', ownerAccountId: 'o', selfAthleteId: 'a' })).toBe(true)
    expect(isRemoteSessionTarget({ kind: 'scoped', athleteId: '' })).toBe(false)
  })
})
