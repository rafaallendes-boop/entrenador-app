import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import {
  getMembershipAthleteIds,
  getRoleForAthlete,
  getSelfMembership,
  membershipFromRemoteRow,
  replaceMembershipCache,
} from '../membershipCache'
import { ATHLETE_PROFILE_LOCAL_ID, setSelfAthleteId } from '../activeAthlete'
import { athleteProfileToRow, createAthleteProfileFullResetRow } from '../../syncUtils'

describe('membershipCache', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  it('maps and replaces only the requested account snapshot', async () => {
    await db.athleteMemberships.put({ athleteId: 'other', accountId: 'u2', role: 'self', createdAt: 1, updatedAt: 1 })
    const self = membershipFromRemoteRow({ athlete_id: 'self', account_id: 'u1', role: 'self', created_at: 2, updated_at: 3 })
    await replaceMembershipCache('u1', [self, { ...self, athleteId: 'managed', role: 'coach' }])
    expect((await getSelfMembership('u1'))?.athleteId).toBe('self')
    expect((await getMembershipAthleteIds('u1')).sort()).toEqual(['managed', 'self'])
    expect(await getRoleForAthlete('u1', 'managed')).toBe('coach')
    expect(await db.athleteMemberships.where('accountId').equals('u2').count()).toBe(1)
  })

  it('anchors self profile writes and reset markers to a claimed self membership', () => {
    setSelfAthleteId('ath_claimed')
    expect(athleteProfileToRow({
      id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: 1, name: 'Ana',
    }, 'u1').athlete_id).toBe('ath_claimed')
    expect(createAthleteProfileFullResetRow('u1', 2).athlete_id).toBe('ath_claimed')
    setSelfAthleteId(null)
  })
})
