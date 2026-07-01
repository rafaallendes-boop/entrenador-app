import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'

describe('Dexie v14 compound natural key', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('allows two athletes to have a day log on the same date', async () => {
    await db.dayLogs.put({ id: 'd1', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1 })
    await db.dayLogs.put({ id: 'd2', athleteId: 'ath_B', date: '2026-06-30', updatedAt: 1 })
    expect(await db.dayLogs.count()).toBe(2)
  })

  it('enforces uniqueness per (athleteId, date)', async () => {
    await db.dayLogs.put({ id: 'd1', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1 })
    await expect(
      db.dayLogs.add({ id: 'd3', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 2 }),
    ).rejects.toBeTruthy()
  })

  it('supports compound-range lookups for a week', async () => {
    await db.dayLogs.bulkPut([
      { id: 'a', athleteId: 'ath_A', date: '2026-06-29', updatedAt: 1 },
      { id: 'b', athleteId: 'ath_A', date: '2026-07-01', updatedAt: 1 },
      { id: 'c', athleteId: 'ath_B', date: '2026-06-29', updatedAt: 1 },
    ])
    const rows = await db.dayLogs
      .where('[athleteId+date]')
      .between(['ath_A', '2026-06-29'], ['ath_A', '2026-07-05'], true, true)
      .toArray()
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('weekSummaries: two athletes share a week, uniqueness per (athleteId, weekStartDate)', async () => {
    await db.weekSummaries.put({ id: 'w1', athleteId: 'ath_A', weekStartDate: '2026-06-29', updatedAt: 1, ...emptyWeek() })
    await db.weekSummaries.put({ id: 'w2', athleteId: 'ath_B', weekStartDate: '2026-06-29', updatedAt: 1, ...emptyWeek() })
    expect(await db.weekSummaries.count()).toBe(2)
    await expect(
      db.weekSummaries.add({ id: 'w3', athleteId: 'ath_A', weekStartDate: '2026-06-29', updatedAt: 2, ...emptyWeek() }),
    ).rejects.toBeTruthy()
  })
})

describe('Dexie v13 to v14 upgrade', () => {
  afterEach(() => {
    db.close()
  })

  it('migrates v13 data to v14 with no loss and a working compound index', async () => {
    db.close()
    await db.delete()

    const legacy = new Dexie('EntrenadorDB')
    legacy.version(13).stores({
      sessions:           'id, date, weekStartDate, type, status, completedAt, athleteId',
      dayLogs:            'id, &date, athleteId',
      weekSummaries:      'id, &weekStartDate, athleteId',
      chatMessages:       'id, timestamp, chatSessionId, athleteId',
      coachProposals:     'id, status, createdAt, resolvedAt, chatMessageId, athleteId',
      athleteProfiles:    'id, updatedAt, athleteId',
      trainingPlans:      'id, athleteId, goalEventId, status, startDate, updatedAt',
      trainingPlanWeeks:  'id, planId, weekStartDate, status, [planId+weekIndex], athleteId',
      planGenerationJobs: 'id, planId, athleteId, status, updatedAt, createdAt',
      syncDiagnostics:    '++id, timestamp, kind, entity, status',
      syncErrorLog:       '++id, timestamp, entity, errorCategory',
      aiRequestLogs:      'traceId, requestClass, surface, status, provider, startedAt, completedAt',
      coachFeedback:      'id, targetType, targetId, traceId, proposalId, chatMessageId, rating, createdAt',
      athletes:           'id, ownerAccountId, updatedAt',
    })
    await legacy.open()
    await legacy.table('dayLogs').bulkPut([
      { id: 'd1', date: '2026-06-29', athleteId: 'ath_A', updatedAt: 1, sleepHours: 7 },
      { id: 'd2', date: '2026-06-30', updatedAt: 1 },
    ])
    await legacy.table('weekSummaries').put({
      id: 'w1',
      weekStartDate: '2026-06-29',
      athleteId: 'ath_A',
      updatedAt: 1,
      ...emptyWeek(),
    })
    legacy.close()

    await db.open()

    expect(await db.dayLogs.count()).toBe(2)
    expect((await db.dayLogs.get('d1'))?.athleteId).toBe('ath_A')
    expect((await db.dayLogs.get('d2'))?.athleteId).toBeUndefined()
    expect((await db.weekSummaries.get('w1'))?.weekStartDate).toBe('2026-06-29')
    const scoped = await db.dayLogs.where('[athleteId+date]').equals(['ath_A', '2026-06-29']).first()
    expect(scoped?.id).toBe('d1')
  })
})

function emptyWeek() {
  return {
    totalSessions: 0,
    totalMinutes: 0,
    plannedSessions: 0,
    completedSessions: 0,
    plannedMinutes: 0,
    completedMinutes: 0,
    squashSessions: 0,
    runningSessions: 0,
    strengthSessions: 0,
  }
}
