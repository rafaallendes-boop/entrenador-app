import { describe, it, expect, afterEach } from 'vitest'
import { isRowInActiveScope, filterRowsToActiveScope, withActiveAthleteStamp } from '../activeScopeFilter'
import { setActiveAthleteId, setSelfAthleteId } from '../activeAthlete'

describe('isRowInActiveScope', () => {
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('no active athlete (legacy mode) → everything in scope', () => {
    expect(isRowInActiveScope('ath_A')).toBe(true)
    expect(isRowInActiveScope(undefined)).toBe(true)
    expect(isRowInActiveScope('default')).toBe(true)
  })

  it('scoped rows must match the active athlete', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    expect(isRowInActiveScope('ath_self')).toBe(true)
    expect(isRowInActiveScope('ath_other')).toBe(false)
  })

  it('self active → legacy/unscoped rows are in scope', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    expect(isRowInActiveScope(undefined)).toBe(true)
    expect(isRowInActiveScope('')).toBe(true)
    expect(isRowInActiveScope('default')).toBe(true)
  })

  it('managed active → legacy/unscoped rows are NOT in scope', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    expect(isRowInActiveScope(undefined)).toBe(false)
    expect(isRowInActiveScope('default')).toBe(false)
    expect(isRowInActiveScope('ath_m_1')).toBe(true)
    expect(isRowInActiveScope('ath_self')).toBe(false)
  })
})

describe('filterRowsToActiveScope', () => {
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('filters by athleteId with the same policy', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    const rows = [
      { id: 'a', athleteId: 'ath_m_1' },
      { id: 'b', athleteId: 'ath_self' },
      { id: 'c' },
      { id: 'd', athleteId: 'default' },
    ]
    expect(filterRowsToActiveScope(rows).map((r) => r.id)).toEqual(['a'])
  })
})

describe('withActiveAthleteStamp', () => {
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('estampa el atleta activo en filas nuevas sin scope', () => {
    setActiveAthleteId('ath_m_1')
    expect(withActiveAthleteStamp({ id: 'x' }).athleteId).toBe('ath_m_1')
    expect(withActiveAthleteStamp({ id: 'x', athleteId: 'default' }).athleteId).toBe('ath_m_1')
  })

  it('preserva un athleteId ya scoped (updates/rollbacks intactos)', () => {
    setActiveAthleteId('ath_m_1')
    expect(withActiveAthleteStamp({ id: 'x', athleteId: 'ath_self' }).athleteId).toBe('ath_self')
  })

  it('sin atleta activo devuelve la fila intacta (no escribe athleteId)', () => {
    const row = withActiveAthleteStamp({ id: 'x' } as { id: string; athleteId?: string })
    expect(row.athleteId).toBeUndefined()
  })
})
