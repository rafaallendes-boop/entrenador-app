import { describe, expect, it } from 'vitest'
import { isDeleteConfirmed } from '../deleteConfirmation'

describe('isDeleteConfirmed', () => {
  it('exige el nombre exacto con trim y sin distinguir mayusculas', () => {
    expect(isDeleteConfirmed('Ana', 'Ana')).toBe(true)
    expect(isDeleteConfirmed('  ana  ', 'Ana')).toBe(true)
    expect(isDeleteConfirmed('An', 'Ana')).toBe(false)
    expect(isDeleteConfirmed('', 'Ana')).toBe(false)
  })

  it('sin displayName nunca habilita', () => {
    expect(isDeleteConfirmed('', null)).toBe(false)
    expect(isDeleteConfirmed('', undefined)).toBe(false)
    expect(isDeleteConfirmed('   ', '   ')).toBe(false)
  })
})
