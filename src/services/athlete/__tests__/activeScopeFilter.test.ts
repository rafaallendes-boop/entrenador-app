import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isRowInActiveScope, filterRowsToActiveScope, withActiveAthleteStamp } from '../activeScopeFilter'
import { setActiveAthleteId, setSelfAthleteId } from '../activeAthlete'
import { setAccountRole } from '../../entitlements/accountRoleHolder'

describe('isRowInActiveScope', () => {
  // An athlete retains the old single-athlete read behavior until its scope
  // hydrates. Other roles are covered explicitly below and fail closed.
  beforeEach(() => setAccountRole('athlete'))

  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    setAccountRole('unknown')
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

  // Un rol ilegible NO cierra el scope: sólo un rol coach confirmado lo hace.
  // Cerrarlo dejaba la app en blanco offline y para toda cuenta sin fila de
  // entitlement. Ver `athleteScopeKind.ts`.
  it('unknown behaves like an athlete account', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    setAccountRole('unknown')
    expect(isRowInActiveScope('ath_m_1')).toBe(true)
    // Las filas legacy siguen siendo exclusivas del self, también con unknown.
    expect(isRowInActiveScope(undefined)).toBe(false)

    setActiveAthleteId('ath_self')
    expect(isRowInActiveScope(undefined)).toBe(true)
  })

  it('coach without an active athlete has an empty scope', () => {
    setAccountRole('coach')
    expect(isRowInActiveScope('ath_m_1')).toBe(false)
    expect(isRowInActiveScope(undefined)).toBe(false)
  })

  it('coach with an active athlete reads only its scoped rows', () => {
    setAccountRole('coach')
    setActiveAthleteId('ath_m_1')
    expect(isRowInActiveScope('ath_m_1')).toBe(true)
    expect(isRowInActiveScope('ath_m_2')).toBe(false)
    expect(isRowInActiveScope(undefined)).toBe(false)
  })
})

describe('filterRowsToActiveScope', () => {
  beforeEach(() => setAccountRole('athlete'))

  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    setAccountRole('unknown')
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
  beforeEach(() => setAccountRole('athlete'))

  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    setAccountRole('unknown')
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
