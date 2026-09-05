import { describe, expect, it } from 'vitest'
import { canAdoptLegacyRows, resolveAthleteScopeKind, roleOwnsLegacySelfData } from '../athleteScopeKind'

describe('cuenta de atleta', () => {
  it('sin hidratar conserva el scope legacy self', () => {
    const kind = resolveAthleteScopeKind({
      accountRole: 'athlete', activeAthleteId: null, selfAthleteId: null,
    })
    expect(kind).toBe('self')
    expect(canAdoptLegacyRows(kind)).toBe(true)
  })

  it('distingue self de managed', () => {
    expect(resolveAthleteScopeKind({
      accountRole: 'athlete', activeAthleteId: 'a1', selfAthleteId: 'a1',
    })).toBe('self')
    const managed = resolveAthleteScopeKind({
      accountRole: 'athlete', activeAthleteId: 'a2', selfAthleteId: 'a1',
    })
    expect(managed).toBe('managed')
    expect(canAdoptLegacyRows(managed)).toBe(false)
  })
})

describe('cuenta coach', () => {
  it('sin atleta activo es none, nunca self', () => {
    const kind = resolveAthleteScopeKind({
      accountRole: 'coach', activeAthleteId: null, selfAthleteId: null,
    })
    expect(kind).toBe('none')
    expect(canAdoptLegacyRows(kind)).toBe(false)
  })

  it('un atleta activo es managed incluso si coincide con self', () => {
    expect(resolveAthleteScopeKind({
      accountRole: 'coach', activeAthleteId: 'a1', selfAthleteId: 'a1',
    })).toBe('managed')
  })
})

/**
 * El scope local es un filtro de LECTURA, no la frontera de seguridad — esa es
 * la RLS del servidor. Cerrarlo ante un rol ilegible deja la app en blanco
 * offline y para toda cuenta sin fila de entitlement, que hoy son casi todas.
 * Sólo evidencia POSITIVA de rol coach cierra el scope.
 */
describe('rol unknown', () => {
  it('se comporta como athlete: conserva el scope legacy self', () => {
    const kind = resolveAthleteScopeKind({
      accountRole: 'unknown', activeAthleteId: null, selfAthleteId: null,
    })
    expect(kind).toBe('self')
    expect(canAdoptLegacyRows(kind)).toBe(true)
  })

  it('distingue self de managed igual que una cuenta athlete', () => {
    expect(resolveAthleteScopeKind({
      accountRole: 'unknown', activeAthleteId: 'a1', selfAthleteId: 'a1',
    })).toBe('self')
    expect(resolveAthleteScopeKind({
      accountRole: 'unknown', activeAthleteId: 'a2', selfAthleteId: 'a1',
    })).toBe('managed')
  })

  it('sólo un rol coach confirmado cierra el scope', () => {
    expect(resolveAthleteScopeKind({
      accountRole: 'coach', activeAthleteId: null, selfAthleteId: null,
    })).toBe('none')
  })
})

/**
 * Autoridad única de "¿esta cuenta es dueña de las filas legacy/unscoped?".
 * La consultan el bootstrap (backfill y migración) y `App.tsx` en sus
 * re-syncs; tenerla en un solo lugar evita que las tres copias del predicado
 * se desincronicen.
 */
describe('roleOwnsLegacySelfData', () => {
  it('sólo un coach confirmado queda excluido', () => {
    expect(roleOwnsLegacySelfData('athlete')).toBe(true)
    expect(roleOwnsLegacySelfData('unknown')).toBe(true)
    expect(roleOwnsLegacySelfData('coach')).toBe(false)
  })
})
