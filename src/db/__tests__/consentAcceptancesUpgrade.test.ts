import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../db'

const DB_NAME = db.name

/** Esquema efectivo de v18, antes de agregar consentAcceptances. */
async function openLegacyV18() {
  const legacy = new Dexie(DB_NAME)
  legacy.version(18).stores({
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
  })
  await legacy.open()
  return legacy
}

describe('Dexie v19 — upgrade real desde v18', () => {
  beforeEach(async () => {
    db.close()
    await Dexie.delete(DB_NAME)
  })

  afterEach(async () => {
    db.close()
    await Dexie.delete(DB_NAME)
  })

  it('migra una base v18 con datos sin perderlos', async () => {
    const legacy = await openLegacyV18()
    await legacy.table('sessionTemplates').put({
      id: 'tpl-1',
      kind: 'strength',
      updatedAt: 1,
      name: 'Fuerza base',
    })
    legacy.close()

    await db.open()

    expect(db.verno).toBe(19)
    expect(db.consentAcceptances).toBeDefined()
    const survived = await db.sessionTemplates.get('tpl-1')
    expect(survived?.name).toBe('Fuerza base')
  })

  it('el índice compuesto impide duplicar la misma aceptación', async () => {
    await db.open()
    const row = {
      id: 'row-1',
      userId: 'user-1',
      document: 'terms' as const,
      version: '2026-07-13',
      acceptedAt: '2026-08-03T10:00:00.000Z',
    }
    await db.consentAcceptances.put(row)

    await expect(
      db.consentAcceptances.add({ ...row, id: 'row-2' }),
    ).rejects.toMatchObject({ name: 'ConstraintError' })
  })

  it('separa aceptaciones por cuenta en el mismo dispositivo', async () => {
    await db.open()
    await db.consentAcceptances.bulkPut([
      {
        id: 'a',
        userId: 'user-1',
        document: 'terms',
        version: '2026-07-13',
        acceptedAt: '2026-08-03T10:00:00.000Z',
      },
      {
        id: 'b',
        userId: 'user-2',
        document: 'terms',
        version: '2026-07-13',
        acceptedAt: '2026-08-03T10:00:00.000Z',
      },
    ])

    const mine = await db.consentAcceptances.where('userId').equals('user-1').toArray()
    expect(mine).toHaveLength(1)
    expect(mine[0]!.id).toBe('a')
  })
})
