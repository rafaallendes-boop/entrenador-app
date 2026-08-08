import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../db/db'
import { exportAppData, parseAppDataExport } from '../dataExport'

function backupWith(workout: Record<string, unknown>) {
  return {
    app: 'RallyIQ',
    version: 4,
    exportedAt: '2026-08-08T00:00:00.000Z',
    exportedFromAppVersion: 'test',
    tables: {
      sessions: [], dayLogs: [], readinessDaily: [], weekSummaries: [],
      trainingPlans: [], trainingPlanWeeks: [], chatMessages: [],
      coachProposals: [], athleteProfiles: [], athletes: [],
      athleteCoachNotes: [], sessionTemplates: [], athleteMemberships: [],
      whoopWorkouts: [{
        id: 'whoop:ath-1:w1', workoutId: 'w1', athleteId: 'ath-1',
        date: '2026-08-04', sportName: 'squash',
        startAt: '2026-08-04T10:00:00.000Z', endAt: '2026-08-04T11:00:00.000Z',
        durationMin: 60, scoreState: 'SCORED', updatedAt: 1,
        ...workout,
      }],
    },
  }
}

function parsedWorkout(workout: Record<string, unknown>) {
  return parseAppDataExport(backupWith(workout)).tables.whoopWorkouts[0]
}

const VALID = { z0: 1000, z1: 2000, z2: 3000, z3: 4000, z4: 5000, z5: 6000 }

describe('parseWhoopWorkout — zonas de FC', () => {
  it('conserva una distribución válida y su cobertura', () => {
    const row = parsedWorkout({ zoneDurations: VALID, percentRecorded: 98.5 })
    expect(row.zoneDurations).toEqual(VALID)
    expect(row.percentRecorded).toBe(98.5)
  })

  it.each([
    ['parcial', { ...VALID, z3: undefined }],
    ['negativa', { ...VALID, z1: -1 }],
    ['vacía', { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }],
    ['no entera', { ...VALID, z2: 1.5 }],
    // Primitiva: es el caso que distingue `isRecord` de `ensureRecord`. Con
    // `ensureRecord` este test no vería `undefined`, vería una excepción, y el
    // backup entero quedaría rechazado por un campo opcional roto.
    ['primitiva', 5],
    ['string', 'muchas zonas'],
  ])('importa SIN zonas —no falla— una distribución %s', (_label, zoneDurations) => {
    const row = parsedWorkout({ zoneDurations, percentRecorded: 72.4 })
    expect(row.workoutId).toBe('w1')
    expect(row.zoneDurations).toBeUndefined()
    expect(row.percentRecorded).toBe(72.4)
  })

  it.each(['PENDING_SCORE', 'UNSCORABLE'])(
    'descarta AMBOS datos cuando el estado es %s, conservando el entrenamiento',
    (scoreState) => {
      const row = parsedWorkout({ scoreState, zoneDurations: VALID, percentRecorded: 98.5 })
      expect(row.workoutId).toBe('w1')
      expect(row.zoneDurations).toBeUndefined()
      expect(row.percentRecorded).toBeUndefined()
    },
  )

  it('un entrenamiento sin los campos nuevos se importa igual que antes', () => {
    const row = parsedWorkout({})
    expect(row.zoneDurations).toBeUndefined()
    expect(row.percentRecorded).toBeUndefined()
    expect(row.durationMin).toBe(60)
  })
})

describe('round-trip real de zonas de FC', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('exportAppData → parseAppDataExport conserva zoneDurations y percentRecorded', async () => {
    await db.whoopWorkouts.put({
      id: 'whoop:ath-1:w1', workoutId: 'w1', athleteId: 'ath-1',
      date: '2026-08-04', sportName: 'squash',
      startAt: '2026-08-04T10:00:00.000Z', endAt: '2026-08-04T11:00:00.000Z',
      durationMin: 60, scoreState: 'SCORED', updatedAt: 1,
      zoneDurations: VALID, percentRecorded: 98.5,
    } as never)

    const { json } = await exportAppData()
    const parsed = parseAppDataExport(JSON.parse(json))

    const imported = parsed.tables.whoopWorkouts.find((row) => row.workoutId === 'w1')
    expect(imported?.zoneDurations).toEqual(VALID)
    expect(imported?.percentRecorded).toBe(98.5)
  })
})
