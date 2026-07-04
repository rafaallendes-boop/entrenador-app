import { describe, it, expect } from 'vitest'
import {
  ATHLETE_PROFILE_SELF_GROUP,
  athleteProfileGroupKey,
  groupAthleteProfileRows,
  athleteProfileToRow,
  rowToAthleteProfile,
  createAthleteProfileFullResetRow,
  type AthleteProfileSyncRow,
} from '../syncUtils'
import { ATHLETE_PROFILE_LOCAL_ID } from '../athlete/activeAthlete'
import type { AthleteProfile } from '../../types'

const syncRow = (partial: Partial<AthleteProfileSyncRow>): AthleteProfileSyncRow => ({
  id: 'r1', user_id: 'user-1', athlete_id: null, coach_memory: null, updated_at: 1, data: null,
  ...partial,
})

describe('athleteProfileGroupKey', () => {
  it('self, legacy null y sentinel caen al grupo self', () => {
    expect(athleteProfileGroupKey('ath_self', 'ath_self')).toBe(ATHLETE_PROFILE_SELF_GROUP)
    expect(athleteProfileGroupKey(null, 'ath_self')).toBe(ATHLETE_PROFILE_SELF_GROUP)
    expect(athleteProfileGroupKey(undefined, 'ath_self')).toBe(ATHLETE_PROFILE_SELF_GROUP)
    expect(athleteProfileGroupKey(ATHLETE_PROFILE_LOCAL_ID, 'ath_self')).toBe(ATHLETE_PROFILE_SELF_GROUP)
  })
  it('un gestionado es su propio grupo', () => {
    expect(athleteProfileGroupKey('ath_m_1', 'ath_self')).toBe('ath_m_1')
  })
  it('sin self hidratado, cualquier scoped es su propio grupo y legacy es self', () => {
    expect(athleteProfileGroupKey('ath_x', null)).toBe('ath_x')
    expect(athleteProfileGroupKey(null, null)).toBe(ATHLETE_PROFILE_SELF_GROUP)
  })
})

describe('groupAthleteProfileRows', () => {
  it('agrupa filas remotas por grupo', () => {
    const rows = [
      syncRow({ id: 'a', athlete_id: 'ath_self' }),
      syncRow({ id: 'b', athlete_id: null }),
      syncRow({ id: 'c', athlete_id: 'ath_m_1' }),
    ]
    const groups = groupAthleteProfileRows(rows, 'ath_self')
    expect([...groups.keys()].sort()).toEqual(['ath_m_1', ATHLETE_PROFILE_SELF_GROUP])
    expect(groups.get(ATHLETE_PROFILE_SELF_GROUP)?.map((r) => r.id)).toEqual(['a', 'b'])
    expect(groups.get('ath_m_1')?.map((r) => r.id)).toEqual(['c'])
  })
})

describe('remote id + athlete_id por atleta', () => {
  it('el self conserva profile:${userId}', () => {
    const row = athleteProfileToRow({ id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: 1, athleteId: 'ath_user-1' } as AthleteProfile, 'user-1')
    expect(row.id).toBe('profile:user-1')
    expect(row.athlete_id).toBe('ath_user-1')
  })
  it('el self legacy (sin athleteId local) NUNCA sale con athlete_id null: estampa athleteIdForOwner', () => {
    const row = athleteProfileToRow({ id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: 1 } as AthleteProfile, 'user-1')
    expect(row.athlete_id).toBe('ath_user-1')
  })
  it('un gestionado usa profile:${userId}:${localId} y su propio athlete_id', () => {
    const row = athleteProfileToRow({ id: 'ath_m_1', updatedAt: 1, athleteId: 'ath_m_1' } as AthleteProfile, 'user-1')
    expect(row.id).toBe('profile:user-1:ath_m_1')
    expect(row.athlete_id).toBe('ath_m_1')
  })
  it('un gestionado sin athleteId explícito hereda su localId como athlete_id (nunca null)', () => {
    const row = athleteProfileToRow({ id: 'ath_m_1', updatedAt: 1 } as AthleteProfile, 'user-1')
    expect(row.athlete_id).toBe('ath_m_1')
  })
  it('mismatch: el self corrupto con athleteId de gestionado SIGUE saliendo como self', () => {
    const row = athleteProfileToRow({ id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: 1, athleteId: 'ath_m_1' } as AthleteProfile, 'user-1')
    expect(row.id).toBe('profile:user-1')
    expect(row.athlete_id).toBe('ath_user-1')
  })
  it('mismatch: un gestionado con athleteId ajeno sale con SU localId', () => {
    const row = athleteProfileToRow({ id: 'ath_m_1', updatedAt: 1, athleteId: 'ath_m_2' } as AthleteProfile, 'user-1')
    expect(row.athlete_id).toBe('ath_m_1')
  })
  it('el full-reset marker también estampa el self athlete_id', () => {
    const marker = createAthleteProfileFullResetRow('user-1', 99)
    expect(marker.athlete_id).toBe('ath_user-1')
  })
})

describe('rowToAthleteProfile group-aware', () => {
  it('grupo self → id local sentinel (compat)', () => {
    const profile = rowToAthleteProfile(syncRow({ athlete_id: 'ath_self', updated_at: 5 }), 'ath_self')
    expect(profile.id).toBe(ATHLETE_PROFILE_LOCAL_ID)
    expect(profile.id).not.toBe('ath_self')
  })
  it('gestionado → id local = athleteId', () => {
    const profile = rowToAthleteProfile(syncRow({ athlete_id: 'ath_m_1', updated_at: 5 }), 'ath_self')
    expect(profile.id).toBe('ath_m_1')
    expect(profile.athleteId).toBe('ath_m_1')
  })
  it('con selfAthleteId null explícito, legacy null sigue cayendo al sentinel', () => {
    const profile = rowToAthleteProfile(syncRow({ athlete_id: null, updated_at: 5 }), null)
    expect(profile.id).toBe(ATHLETE_PROFILE_LOCAL_ID)
  })
})
