import { describe, expect, it } from 'vitest'
import type { OfflineOp } from '../../syncUtils'
import { isSameQueuedOpVersion } from '../syncQueue'

const base: OfflineOp = {
  userId: 'u', table: 'sessions', action: 'upsert', enqueuedAt: 100,
  payload: { id: 's', data: { title: 'A' } }, scopeAthleteId: 'ath',
  sessionTarget: { kind: 'scoped', athleteId: 'ath' },
}

describe('isSameQueuedOpVersion', () => {
  it('ignora metadata mutable de retry', () => {
    expect(isSameQueuedOpVersion(base, {
      ...base, retryCount: 3, lastErrorCategory: 'network_error',
    })).toBe(true)
  })

  it('distingue payload, scope, target y replay', () => {
    expect(isSameQueuedOpVersion(base, { ...base, payload: { id: 's', data: { title: 'B' } } })).toBe(false)
    expect(isSameQueuedOpVersion(base, { ...base, scopeAthleteId: 'other' })).toBe(false)
    expect(isSameQueuedOpVersion(base, {
      ...base, sessionTarget: { kind: 'scoped', athleteId: 'other' },
    })).toBe(false)
    expect(isSameQueuedOpVersion(base, { ...base, replayKind: 'weekSummaryForAthlete' })).toBe(false)
  })

  it('no depende del orden de claves serializadas', () => {
    expect(isSameQueuedOpVersion(base, {
      ...base, payload: { data: { title: 'A' }, id: 's' },
    })).toBe(true)
  })
})
