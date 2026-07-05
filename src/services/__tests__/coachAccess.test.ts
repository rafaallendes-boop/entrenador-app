import { describe, expect, it } from 'vitest'
import { isCoachAccount, parseCoachAllowlist } from '../athlete/coachAccess'

describe('coachAccess', () => {
  it('parseCoachAllowlist normaliza (trim, lowercase, vacíos fuera)', () => {
    expect(parseCoachAllowlist(' Rafa.Allendes@Gmail.com , otro@x.cl ,, ')).toEqual([
      'rafa.allendes@gmail.com',
      'otro@x.cl',
    ])
    expect(parseCoachAllowlist('')).toEqual([])
    expect(parseCoachAllowlist(undefined)).toEqual([])
  })

  it('isCoachAccount matchea por email case-insensitive', () => {
    const user = { email: 'Rafa.Allendes@gmail.com' }
    expect(isCoachAccount(user, 'rafa.allendes@gmail.com')).toBe(true)
    expect(isCoachAccount(user, 'otra@persona.cl')).toBe(false)
  })

  it('default vacío → nadie es coach', () => {
    expect(isCoachAccount({ email: 'rafa.allendes@gmail.com' }, undefined)).toBe(false)
    expect(isCoachAccount({ email: 'rafa.allendes@gmail.com' }, '')).toBe(false)
    expect(isCoachAccount(null, 'rafa.allendes@gmail.com')).toBe(false)
  })
})
