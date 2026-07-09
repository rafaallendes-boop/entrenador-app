import { describe, expect, it } from 'vitest'
import { prefillDayLog } from '../prefillDayLog'

const readiness = {
  id: 'whoop:ath_u1:2026-06-21',
  athleteId: 'ath_u1',
  date: '2026-06-21',
  recoveryScore: 28,
  sleepHours: 5.2,
  sleepPerformance: 61,
  strain: 14.1,
  source: 'whoop',
  updatedAt: 1,
}

describe('prefillDayLog', () => {
  it('fills empty fields and records source', () => {
    const { patch, prefillSource } = prefillDayLog({}, readiness)
    expect(patch.sleepHours).toBe(5.2)
    expect(patch.sleepQuality).toBe(3)
    expect(patch.energyLevel).toBe(3)
    expect(prefillSource).toEqual({ sleepHours: 'whoop', sleepQuality: 'whoop', energyLevel: 'whoop' })
  })

  it('does not overwrite a manually-set value (including 0)', () => {
    const { patch, prefillSource } = prefillDayLog({ sleepHours: 7, energyLevel: 0 }, readiness)
    expect(patch.sleepHours).toBeUndefined()
    expect(patch.energyLevel).toBeUndefined()
    expect(patch.sleepQuality).toBe(3)
    expect(prefillSource).toEqual({ sleepQuality: 'whoop' })
  })

  it('returns empty patch when no readiness', () => {
    const { patch, prefillSource } = prefillDayLog({}, undefined)
    expect(patch).toEqual({})
    expect(prefillSource).toEqual({})
  })

  it('never touches painLevel/notes', () => {
    const { patch } = prefillDayLog({}, readiness)
    expect('painLevel' in patch).toBe(false)
    expect('painNotes' in patch).toBe(false)
  })
})
