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
    expect(prefillSource).toEqual({ sleepHours: 'whoop', sleepQuality: 'whoop', energyLevel: 'whoop', rpeActual: 'whoop' })
  })

  it('does not overwrite a manually-set value (including 0)', () => {
    const { patch, prefillSource } = prefillDayLog({ sleepHours: 7, energyLevel: 0 }, readiness)
    expect(patch.sleepHours).toBeUndefined()
    expect(patch.energyLevel).toBeUndefined()
    expect(patch.sleepQuality).toBe(3)
    expect(prefillSource).toEqual({ sleepQuality: 'whoop', rpeActual: 'whoop' })
  })

  it('maps strain to rpeActual (Esfuerzo) and records source', () => {
    const { patch, prefillSource } = prefillDayLog({}, readiness)
    expect(patch.rpeActual).toBe(7) // round(14.1 / 2.1) = 7
    expect(prefillSource.rpeActual).toBe('whoop')
  })

  it('does not overwrite an existing rpeActual (including 0)', () => {
    expect(prefillDayLog({ rpeActual: 9 }, readiness).patch.rpeActual).toBeUndefined()
    expect(prefillDayLog({ rpeActual: 0 }, readiness).patch.rpeActual).toBeUndefined()
  })

  it('refreshes a previously Whoop-sourced rpeActual when strain grew (cumulative)', () => {
    const { patch, prefillSource } = prefillDayLog(
      { rpeActual: 4, prefillSource: { rpeActual: 'whoop' } },
      readiness,
    )
    expect(patch.rpeActual).toBe(7) // round(14.1 / 2.1) = 7, refreshed from stale 4
    expect(prefillSource.rpeActual).toBe('whoop')
  })

  it('does not churn the patch when the Whoop-sourced rpeActual already matches', () => {
    const { patch, prefillSource } = prefillDayLog(
      { rpeActual: 7, prefillSource: { rpeActual: 'whoop' } },
      readiness,
    )
    expect('rpeActual' in patch).toBe(false)
    expect(prefillSource.rpeActual).toBe('whoop')
  })

  it('never overwrites a manual rpeActual even if strain maps higher', () => {
    const { patch, prefillSource } = prefillDayLog({ rpeActual: 3 }, readiness)
    expect(patch.rpeActual).toBeUndefined()
    expect(prefillSource.rpeActual).toBeUndefined()
  })

  it('clamps strain mapping into 1-10', () => {
    expect(prefillDayLog({}, { ...readiness, strain: 21 }).patch.rpeActual).toBe(10)
    expect(prefillDayLog({}, { ...readiness, strain: 0.5 }).patch.rpeActual).toBe(1)
  })

  it('does not set rpeActual when strain is absent', () => {
    const { patch, prefillSource } = prefillDayLog({}, { ...readiness, strain: undefined })
    expect('rpeActual' in patch).toBe(false)
    expect(prefillSource.rpeActual).toBeUndefined()
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
