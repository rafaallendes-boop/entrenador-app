import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Session } from '../../../types'
import { db } from '../../../db/db'
import { setSelfAthleteId } from '../../athlete/activeAthlete'
import { resolveAuthoredByRole } from '../../athlete/activeScopeFilter'
import { replaceMembershipCache } from '../../athlete/membershipCache'
import { getEntityIdFromPayload } from '../../syncUtils'
import { buildMarkSessionDoneParams, shouldRouteSessionCompletionViaRpc } from '../sessionCompletion'

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's1', athleteId: 'ath_1', authoredByRole: 'coach', date: '2026-07-06',
  timeBlock: 'AM', type: 'squash', status: 'completed', title: 'Match', durationMin: 60,
  completedAt: 50, actualRpe: 7, actualDurationMin: 55, completionNotes: 'bien',
  createdAt: 1, updatedAt: 99, ...overrides,
} as Session)

describe('session completion routing', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  it('builds the exact RPC completion whitelist', () => {
    expect(buildMarkSessionDoneParams(session())).toEqual({
      p_session_id: 's1', p_status: 'completed', p_updated_at: 99,
      p_completed_at: 50, p_actual_rpe: 7, p_actual_duration_min: 55,
      p_completion_notes: 'bien', p_session_feedback: null,
    })
  })

  it('routes only a self member editing a coach-authored session', async () => {
    await replaceMembershipCache('u1', [{
      athleteId: 'ath_1', accountId: 'u1', role: 'self', createdAt: 1, updatedAt: 1,
    }])
    expect(await shouldRouteSessionCompletionViaRpc(session(), 'u1')).toBe(true)
    expect(await shouldRouteSessionCompletionViaRpc(session({ authoredByRole: 'self' }), 'u1')).toBe(false)
  })

  it('stamps authorship and identifies non-standard queue payloads', () => {
    setSelfAthleteId('ath_self')
    expect(resolveAuthoredByRole('ath_self')).toBe('self')
    expect(resolveAuthoredByRole('ath_managed')).toBe('coach')
    expect(getEntityIdFromPayload('sessions', { p_session_id: 's1' })).toBe('s1')
    expect(getEntityIdFromPayload('athlete_coach_notes', { athlete_id: 'ath_1' })).toBe('ath_1')
  })
})
