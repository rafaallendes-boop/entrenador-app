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

/**
 * Entrega 2, paso 1: el gate de UI pasa a leer `account_role`, con la
 * allowlist de email conservada como **puente** hasta que exista y se pruebe
 * la cuenta coach definitiva.
 */
describe('coachAccess — el rol de cuenta habilita la UI de coach', () => {
  it('una cuenta con rol coach entra sin estar en la allowlist', () => {
    expect(isCoachAccount({ email: 'nueva@coach.cl' }, undefined, 'coach')).toBe(true)
    expect(isCoachAccount({ email: 'nueva@coach.cl' }, '', 'coach')).toBe(true)
    expect(isCoachAccount({ email: 'nueva@coach.cl' }, 'otra@persona.cl', 'coach')).toBe(true)
  })

  it('la allowlist sigue habilitando mientras el rol no sea coach (puente)', () => {
    expect(isCoachAccount({ email: 'rafa@x.cl' }, 'rafa@x.cl', 'athlete')).toBe(true)
    expect(isCoachAccount({ email: 'rafa@x.cl' }, 'rafa@x.cl', 'unknown')).toBe(true)
  })

  it('sin rol coach y fuera de la allowlist, nadie entra', () => {
    for (const role of ['athlete', 'unknown'] as const) {
      expect(isCoachAccount({ email: 'otro@x.cl' }, 'rafa@x.cl', role)).toBe(false)
      expect(isCoachAccount({ email: 'otro@x.cl' }, undefined, role)).toBe(false)
    }
  })

  it('el rol coach no necesita email: una cuenta sin email igual es coach por rol', () => {
    // La allowlist exige email; el rol no. Sin esto, una cuenta coach creada
    // por RPC sin email quedaría fuera de su propia UI.
    expect(isCoachAccount({ email: null }, undefined, 'coach')).toBe(true)
    expect(isCoachAccount(null, undefined, 'coach')).toBe(false)
  })
})
