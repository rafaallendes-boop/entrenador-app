import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'

const workout = {
  id: 'whoop:ath_1:w-1',
  workoutId: 'w-1',
  athleteId: 'ath_1',
  date: '2026-07-09',
  sportName: 'squash',
  startAt: '2026-07-09T14:00:00.000Z',
  endAt: '2026-07-09T14:48:00.000Z',
  durationMin: 48,
  scoreState: 'SCORED' as const,
  updatedAt: 1,
}

describe('whoopWorkouts store (v16)', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('stores workouts and reads them by athlete and unique workoutId', async () => {
    await db.whoopWorkouts.put(workout)
    expect((await db.whoopWorkouts.where('workoutId').equals('w-1').first())?.sportName).toBe('squash')
    expect(await db.whoopWorkouts.where('athleteId').equals('ath_1').count()).toBe(1)
  })

  it('performs a real v15 to v16 upgrade preserving readinessDaily', async () => {
    db.close()
    await db.delete()

    const legacy = new Dexie('EntrenadorDB')
    legacy.version(15).stores({
      sessions: 'id, date, weekStartDate, type, status, completedAt, athleteId',
      dayLogs: 'id, date, athleteId, &[athleteId+date]',
      weekSummaries: 'id, weekStartDate, athleteId, &[athleteId+weekStartDate]',
      chatMessages: 'id, timestamp, chatSessionId, athleteId',
      coachProposals: 'id, status, createdAt, resolvedAt, chatMessageId, athleteId',
      athleteProfiles: 'id, updatedAt, athleteId',
      trainingPlans: 'id, athleteId, goalEventId, status, startDate, updatedAt',
      trainingPlanWeeks: 'id, planId, weekStartDate, status, [planId+weekIndex], athleteId',
      planGenerationJobs: 'id, planId, athleteId, status, updatedAt, createdAt',
      syncDiagnostics: '++id, timestamp, kind, entity, status',
      syncErrorLog: '++id, timestamp, entity, errorCategory',
      aiRequestLogs: 'traceId, requestClass, surface, status, provider, startedAt, completedAt',
      coachFeedback: 'id, targetType, targetId, traceId, proposalId, chatMessageId, rating, createdAt',
      athletes: 'id, ownerAccountId, updatedAt',
      readinessDaily: 'id, date, athleteId, source, updatedAt, &[athleteId+date+source]',
    })
    await legacy.open()
    await legacy.table('readinessDaily').put({
      id: 'whoop:ath_1:2026-07-09', athleteId: 'ath_1', date: '2026-07-09',
      recoveryScore: 60, source: 'whoop', updatedAt: 1,
    })
    legacy.close()

    await db.open()
    expect(await db.readinessDaily.get('whoop:ath_1:2026-07-09')).toMatchObject({ recoveryScore: 60 })
    await db.whoopWorkouts.put(workout)
    expect(await db.whoopWorkouts.count()).toBe(1)
  })
})
