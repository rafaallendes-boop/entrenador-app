import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../db/db'
import { exportAppData, parseAppDataExport } from '../dataExport'

function sessionRow(exercises: unknown[]) {
  return {
    id: 'session-superset',
    date: '2026-07-19',
    weekStartDate: '2026-07-13',
    timeBlock: 'AM',
    source: 'coach',
    type: 'strength',
    status: 'planned',
    title: 'Fuerza',
    durationMin: 60,
    createdAt: 1,
    updatedAt: 2,
    exercises,
  }
}

function backupFixture(exercises: unknown[]) {
  return {
    app: 'Entrenador',
    version: 3,
    exportedAt: '2026-07-19T12:00:00.000Z',
    exportedFromAppVersion: 'test',
    tables: {
      sessions: [sessionRow(exercises)],
      dayLogs: [],
      weekSummaries: [],
      trainingPlans: [],
      trainingPlanWeeks: [],
      chatMessages: [],
      coachProposals: [],
      athleteProfiles: [],
    },
  }
}

function backupWithProposalExercises(exercises: unknown[]) {
  const fixture = backupFixture([])
  return {
    ...fixture,
    tables: {
      ...fixture.tables,
      coachProposals: [{
        id: 'proposal-superset',
        message: 'm',
        status: 'pending',
        createdAt: 1,
        actions: [{ type: 'add_session', reason: 'r', exercises }],
      }],
    },
  }
}

describe('supersetGroup en backup/import', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('round-trip real: exportAppData → parseAppDataExport conserva supersetGroup', async () => {
    await db.sessions.put(sessionRow([
      { id: 'e1', name: 'Clean', sets: 4, reps: '3', completed: false, supersetGroup: 'g1' },
      { id: 'e2', name: 'Dominadas', sets: 4, reps: '8', completed: false, supersetGroup: 'g1' },
      { id: 'e3', name: 'Plancha frontal', sets: 3, reps: '30s', completed: false },
    ]) as never)

    const { json } = await exportAppData()
    const parsed = parseAppDataExport(JSON.parse(json))

    const imported = parsed.tables.sessions.find((session) => session.id === 'session-superset')
    const exercises = imported!.exercises!
    expect(exercises.map((e) => e.supersetGroup)).toEqual(['g1', 'g1', undefined])
  })

  it('parseAppDataExport repara un grupo corrupto del backup', () => {
    const parsed = parseAppDataExport(backupFixture([
      { id: 'e1', name: 'Clean', sets: 5, reps: '3', completed: false, supersetGroup: 'g1' },
      { id: 'e2', name: 'Plancha frontal', sets: 3, reps: '30s', completed: false },
      { id: 'e3', name: 'Dominadas', sets: 3, reps: '8', completed: false, supersetGroup: 'g1' },
    ]))

    const exercises = parsed.tables.sessions[0]!.exercises!
    expect(exercises.every((e) => e.supersetGroup == null)).toBe(true)
  })

  it('normaliza grupos y sets en ejercicios de propuestas pendientes', () => {
    const parsed = parseAppDataExport(backupWithProposalExercises([
      { name: 'Clean', sets: 5, reps: 3, supersetGroup: 'g1' },
      { name: 'Dominadas', sets: 3, reps: 8, supersetGroup: 'g1' },
      { name: 'Plancha frontal', sets: 3, reps: '30s', supersetGroup: 'singleton' },
    ]))

    const exercises = parsed.tables.coachProposals[0]!.actions[0]!.exercises!
    expect(exercises.map((exercise) => exercise.supersetGroup)).toEqual(['g1', 'g1', undefined])
    expect(exercises.map((exercise) => exercise.sets)).toEqual([5, 5, 3])
  })
})
