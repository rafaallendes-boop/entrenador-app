import { describe, expect, it } from 'vitest'
import { getRemoteRowAthleteId } from '../remoteRowAthleteId'

describe('getRemoteRowAthleteId', () => {
  it('prefiere athlete_id y conserva compatibilidad con data.athleteId', () => {
    expect(getRemoteRowAthleteId({ athlete_id: 'ath-direct', data: { athleteId: 'ath-nested' } }))
      .toBe('ath-direct')
    expect(getRemoteRowAthleteId({ athlete_id: null, data: { athleteId: 'ath-nested' } }))
      .toBe('ath-nested')
  })

  it('ignora valores vacíos o no string', () => {
    expect(getRemoteRowAthleteId({ athlete_id: '', data: { athleteId: '' } })).toBeUndefined()
    expect(getRemoteRowAthleteId({ athlete_id: 42, data: null })).toBeUndefined()
  })
})
