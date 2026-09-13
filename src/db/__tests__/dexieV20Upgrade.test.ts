import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../db'

const DB_NAME = db.name

/** Esquema efectivo de v19, antes de agregar entitlements. */
async function openLegacyV19() {
  const legacy = new Dexie(DB_NAME)
  legacy.version(19).stores({
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
    whoopWorkouts: 'id, date, athleteId, updatedAt, &workoutId',
    athleteMemberships: '[athleteId+accountId], accountId, athleteId, role',
    athleteCoachNotes: 'athleteId, updatedAt',
    sessionTemplates: 'id, kind, updatedAt, name',
    consentAcceptances: 'id, userId, &[userId+document+version]',
  })
  await legacy.open()
  return legacy
}

describe('Dexie v20 — upgrade real desde v19', () => {
  beforeEach(async () => {
    // fake-indexeddb mantiene esta base solo en memoria dentro de este test.
    db.close()
    await Dexie.delete(DB_NAME)
  })

  afterEach(async () => {
    db.close()
    await Dexie.delete(DB_NAME)
  })

  it('conserva datos previos y agrega la tabla entitlements', async () => {
    const legacy = await openLegacyV19()
    await legacy.table('sessions').put({
      id: 's1',
      date: '2026-08-01',
      athleteId: 'a1',
    })
    await legacy.table('consentAcceptances').put({
      id: 'consent-1',
      userId: 'u1',
      document: 'terms',
      version: '2026-07-13',
    })
    legacy.close()

    await db.open()

    expect(await db.sessions.get('s1')).toMatchObject({ id: 's1' })
    expect(await db.consentAcceptances.get('consent-1')).toMatchObject({ id: 'consent-1' })
    await db.entitlements.put({
      userId: 'u1',
      tier: 'weekly',
      expiresAt: null,
      confirmedAt: 1,
    })
    expect(await db.entitlements.get('u1')).toMatchObject({ tier: 'weekly' })
    expect(db.verno).toBe(21)
    expect(await db.membershipSnapshots.count()).toBe(0)
  })
})
