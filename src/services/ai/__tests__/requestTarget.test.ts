import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveRequestTargetAthleteId } from '../requestTarget'
import * as activeAthlete from '../../athlete/activeAthlete'

function scope(self: string | null, active: string | null) {
  vi.spyOn(activeAthlete, 'getSelfAthleteId').mockReturnValue(self)
  vi.spyOn(activeAthlete, 'getActiveAthleteId').mockReturnValue(active)
}

beforeEach(() => { vi.restoreAllMocks() })

describe('resolveRequestTargetAthleteId', () => {
  it('el atleta activo gestionado viaja', () => {
    scope('ath_self', 'ath_m_1')
    expect(resolveRequestTargetAthleteId()).toBe('ath_m_1')
  })

  it('el self NO viaja: mandarlo produciría un wouldDeny falso', () => {
    scope('ath_self', 'ath_self')
    expect(resolveRequestTargetAthleteId()).toBeNull()
  })

  it('un objetivo explícito gana sobre el scope activo', () => {
    scope('ath_self', 'ath_self')
    expect(resolveRequestTargetAthleteId('ath_m_2')).toBe('ath_m_2')
  })

  it('un objetivo explícito igual al self tampoco viaja', () => {
    scope('ath_self', 'ath_m_1')
    expect(resolveRequestTargetAthleteId('ath_self')).toBeNull()
  })

  it('sin objetivo resoluble devuelve null', () => {
    scope('ath_self', null)
    expect(resolveRequestTargetAthleteId()).toBeNull()
  })

  it('una cuenta sin self (coach) sí manda el gestionado activo', () => {
    scope(null, 'ath_m_1')
    expect(resolveRequestTargetAthleteId()).toBe('ath_m_1')
  })

  it('un explícito null cae al scope activo, no fuerza null', () => {
    scope('ath_self', 'ath_m_1')
    expect(resolveRequestTargetAthleteId(null)).toBe('ath_m_1')
  })
})
