import { describe, expect, it } from 'vitest'

import { parseAppDataExport } from '../dataExport'

const strengthExercises = [
  {
    id: 'exercise-1',
    name: 'Sentadilla',
    sets: 4,
    reps: 6,
    completed: false,
    weight: 112,
    targetPercent1RM: 80,
    targetRpe: 8,
    warmupSets: [
      { reps: 5, weight: 70, percent1RM: 50 },
      { reps: 3, weight: 97.5, percent1RM: 70 },
    ],
  },
]

const coachExercises = strengthExercises.map((exercise) => ({
  name: exercise.name,
  sets: exercise.sets,
  reps: exercise.reps,
  weight: exercise.weight,
  targetPercent1RM: exercise.targetPercent1RM,
  targetRpe: exercise.targetRpe,
  warmupSets: exercise.warmupSets,
}))

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function backupFixture() {
  return {
    app: 'Entrenador',
    version: 3,
    exportedAt: '2026-05-21T12:00:00.000Z',
    exportedFromAppVersion: 'test',
    tables: {
      sessions: [
        {
          id: 'session-1',
          date: '2026-05-21',
          weekStartDate: '2026-05-18',
          timeBlock: 'AM',
          source: 'coach',
          type: 'strength',
          status: 'planned',
          title: 'Fuerza lower',
          durationMin: 60,
          createdAt: 1,
          updatedAt: 2,
          exercises: clone(strengthExercises),
        },
      ],
      dayLogs: [],
      weekSummaries: [],
      trainingPlans: [],
      trainingPlanWeeks: [
        {
          id: 'week-1',
          planId: 'plan-1',
          weekIndex: 0,
          weekStartDate: '2026-05-18',
          phase: 'base',
          status: 'draft',
          sessions: [
            {
              date: '2026-05-21',
              timeBlock: 'AM',
              sessionType: 'strength',
              title: 'Fuerza lower',
              durationMin: 60,
              exercises: clone(coachExercises),
            },
          ],
          weekObjectives: [],
          targetLoadBySport: {},
          validationIssues: [],
          generationMeta: { attempts: 1 },
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      chatMessages: [],
      coachProposals: [
        {
          id: 'proposal-1',
          message: 'Fuerza con cargas',
          actions: [
            {
              type: 'add_session',
              reason: 'carga sugerida',
              targetDate: '2026-05-21',
              sessionType: 'strength',
              title: 'Fuerza lower',
              durationMin: 60,
              timeBlock: 'AM',
              exercises: clone(coachExercises),
            },
          ],
          status: 'pending',
          createdAt: 1,
        },
      ],
      athleteProfiles: [],
    },
  }
}

describe('dataExport strength load metadata', () => {
  it('preserves targetPercent1RM, targetRpe and warmupSets in imported sessions, proposals and plan weeks', () => {
    const parsed = parseAppDataExport(backupFixture())

    expect(parsed.tables.sessions[0].exercises?.[0]).toMatchObject({
      targetPercent1RM: 80,
      targetRpe: 8,
      warmupSets: [
        { reps: 5, weight: 70, percent1RM: 50 },
        { reps: 3, weight: 97.5, percent1RM: 70 },
      ],
    })
    expect(parsed.tables.coachProposals[0].actions[0].exercises?.[0]).toMatchObject({
      targetPercent1RM: 80,
      targetRpe: 8,
      warmupSets: [
        { reps: 5, weight: 70, percent1RM: 50 },
        { reps: 3, weight: 97.5, percent1RM: 70 },
      ],
    })
    expect(parsed.tables.trainingPlanWeeks[0].sessions[0].exercises?.[0]).toMatchObject({
      targetPercent1RM: 80,
      targetRpe: 8,
      warmupSets: [
        { reps: 5, weight: 70, percent1RM: 50 },
        { reps: 3, weight: 97.5, percent1RM: 70 },
      ],
    })
  })

  it('rejects invalid strength load metadata instead of importing impossible values', () => {
    const backup = backupFixture()
    backup.tables.sessions[0].exercises[0].targetPercent1RM = 140

    expect(() => parseAppDataExport(backup)).toThrow(/targetPercent1RM/)
  })

  it('accepts regenerating plan weeks during backup import', () => {
    const backup = backupFixture()
    backup.tables.trainingPlanWeeks[0].status = 'regenerating'

    const parsed = parseAppDataExport(backup)

    expect(parsed.tables.trainingPlanWeeks[0].status).toBe('regenerating')
  })
})
