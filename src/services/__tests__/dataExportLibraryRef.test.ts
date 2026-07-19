import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../db/db'
import { exportAppData, parseAppDataExport } from '../dataExport'

const validRef = { source: 'strength_exercise', id: 'back_squat' } as const

function sessionRow(exercises: unknown[]) {
  return {
    id: 'session-ref',
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

describe('libraryRef en backup/import', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('round-trip real: exportAppData → parseAppDataExport conserva libraryRef', async () => {
    await db.sessions.put(sessionRow([
      {
        id: 'e1',
        name: 'Sentadilla',
        sets: 4,
        reps: 5,
        completed: false,
        libraryRef: validRef,
      },
    ]) as never)

    const { json } = await exportAppData()
    const parsed = parseAppDataExport(JSON.parse(json))

    const imported = parsed.tables.sessions.find((session) => session.id === 'session-ref')
    expect(imported?.exercises?.[0].libraryRef).toEqual(validRef)
  })

  it('descarta refs inválidos del fixture sin perder el ejercicio', () => {
    const parsed = parseAppDataExport(backupFixture([
      {
        id: 'e1',
        name: 'Sentadilla',
        sets: 4,
        reps: 5,
        completed: false,
        libraryRef: { source: 'nope', id: '' },
      },
      {
        id: 'e2',
        name: 'Peso muerto',
        sets: 4,
        reps: 5,
        completed: false,
        libraryRef: 'garbage',
      },
    ]))

    const imported = parsed.tables.sessions[0].exercises
    expect(imported).toHaveLength(2)
    expect(imported?.[0].libraryRef).toBeUndefined()
    expect(imported?.[1].libraryRef).toBeUndefined()
  })
})
