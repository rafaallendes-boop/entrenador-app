import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AthleteProfile, DayLog, Session } from '../../types'
import {
  getAthleteProgressionInsights,
  getSquashMatchHistory,
  getStrengthProgression,
  normalizeExerciseFamily,
} from '../progressionInsights'

const mocks = vi.hoisted(() => ({
  sessionsStore: {
    toArray: vi.fn<() => Promise<Session[]>>(),
  },
  dayLogsStore: {
    toArray: vi.fn<() => Promise<DayLog[]>>(),
  },
  getAthleteProfileMock: vi.fn<() => Promise<AthleteProfile | undefined>>(),
}))

vi.mock('../../db/db', () => ({
  db: {
    sessions: mocks.sessionsStore,
    dayLogs: mocks.dayLogsStore,
  },
}))

vi.mock('../../db/queries', () => ({
  getAthleteProfile: mocks.getAthleteProfileMock,
}))

function makeSession(overrides: Partial<Session> & { type: Session['type'] }): Session {
  const { type, ...rest } = overrides
  return {
    id: `${type}-${overrides.date ?? '2026-04-10'}-${overrides.title ?? 'session'}`,
    date: '2026-04-10',
    timeBlock: 'AM',
    type,
    status: 'completed',
    title: 'Session',
    durationMin: 60,
    createdAt: 1,
    updatedAt: 1,
    ...rest,
  } as Session
}

function makeExercise(name: string, sets: number, reps: number | string, weight?: number) {
  return {
    id: `${name}-${sets}-${reps}`,
    name,
    sets,
    reps,
    weight,
    completed: true,
  }
}

describe('progressionInsights', () => {
  beforeEach(() => {
    mocks.sessionsStore.toArray.mockReset()
    mocks.dayLogsStore.toArray.mockReset()
    mocks.getAthleteProfileMock.mockReset()
  })

  it('normalizes strength families consistently', () => {
    expect(normalizeExerciseFamily('Back squat')).toEqual({ key: 'sentadilla', label: 'Sentadilla' })
    expect(normalizeExerciseFamily('Bench press')).toEqual({ key: 'press banca', label: 'Press banca' })
    expect(normalizeExerciseFamily('Hip thrust')).toEqual({ key: 'hip thrust', label: 'Hip thrust' })
  })

  it('returns the last squash matches in reverse chronological order', () => {
    const matches = getSquashMatchHistory([
      makeSession({ type: 'squash', date: '2026-04-01', subtype: 'match', title: 'Match A', opponent: 'Ana', actualRpe: 8 }),
      makeSession({ type: 'squash', date: '2026-04-03', subtype: 'competitive', title: 'Match B', opponent: 'Bea', actualRpe: 7 }),
      makeSession({ type: 'squash', date: '2026-04-02', subtype: 'training', title: 'Training' }),
    ])

    expect(matches).toHaveLength(2)
    expect(matches[0].title).toBe('Match B')
    expect(matches[1].title).toBe('Match A')
  })

  it('groups strength progressions by family, prioritizes main lifts and computes trend', () => {
    const progression = getStrengthProgression([
      makeSession({
        type: 'strength',
        date: '2026-04-08',
        exercises: [
          makeExercise('Back squat', 4, 5, 100),
          makeExercise('Bench press', 4, 5, 70),
        ],
      }),
      makeSession({
        type: 'strength',
        date: '2026-04-05',
        exercises: [
          makeExercise('Front squat', 4, 4, 95),
          makeExercise('Bench press', 4, 5, 70),
        ],
      }),
      makeSession({
        type: 'strength',
        date: '2026-04-01',
        exercises: [makeExercise('Back squat', 3, 5, 90)],
      }),
    ])

    expect(progression[0].exerciseKey).toBe('sentadilla')
    expect(progression[0].trend).toBe('up')
    expect(progression[0].entries).toHaveLength(2)
    expect(progression.find((item) => item.exerciseKey === 'press banca')?.trendLabel).toBe('estable')
  })

  it('builds athlete progression insights from db data and profile context', async () => {
    const sessions: Session[] = [
      makeSession({
        type: 'squash',
        date: '2026-04-08',
        subtype: 'match',
        title: '2do nacional',
        opponent: 'Rival A',
        actualRpe: 8,
        matchResult: 'win',
        gamesWon: 3,
        gamesLost: 1,
      }),
      makeSession({
        type: 'squash',
        date: '2026-04-06',
        title: 'Drive day',
        durationMin: 60,
        actualDurationMin: 60,
        actualRpe: 7,
        squashDetails: {
          trainingFocus: 'technical',
          drills: [{ name: 'Drives paralelos a profundidad', durationMin: 15 }],
        },
      }),
      makeSession({
        type: 'strength',
        date: '2026-04-07',
        title: 'Lower strength',
        actualDurationMin: 55,
        actualRpe: 7,
        exercises: [
          makeExercise('Back squat', 4, 5, 100),
          makeExercise('Plank', 3, '30s'),
        ],
      }),
      makeSession({
        type: 'strength',
        date: '2026-04-04',
        title: 'Lower strength',
        actualDurationMin: 50,
        actualRpe: 6,
        exercises: [
          makeExercise('Front squat', 4, 4, 95),
          makeExercise('Dead bug', 3, 10),
        ],
      }),
      makeSession({
        type: 'strength',
        date: '2026-04-01',
        title: 'Lower strength',
        actualDurationMin: 45,
        actualRpe: 6,
        exercises: [makeExercise('Goblet squat', 3, 8, 30)],
      }),
    ]

    const dayLogs: DayLog[] = [
      {
        id: '2026-04-08',
        date: '2026-04-08',
        energyLevel: 7,
        painLevel: 1,
        sleepHours: 7.5,
        rpeActual: 6,
        updatedAt: 1,
      },
    ]

    const profile: AthleteProfile = {
      id: 'default',
      updatedAt: 1,
      primarySport: 'squash',
      mainGoal: 'competir mejor',
      sportContext: {
        enabledSports: ['squash', 'strength'],
        primarySport: 'squash',
        secondarySports: ['strength'],
        trainingPriority: 'performance',
      },
      goalEvents: [
        {
          id: 'goal-1',
          title: '2do nacional',
          date: '2026-04-09',
          sport: 'squash',
          priority: 'primary',
          eventType: 'tournament',
        },
      ],
      strengthProfile: {
        squat1RM: 120,
        benchPress1RM: 90,
      },
      planWizardConfig: {
        goalEventId: 'goal-1',
        trainingDays: ['monday', 'wednesday', 'friday'],
        sessionsPerWeek: 4,
        sessionDurationMins: 60,
        allowDoubleSession: false,
        complementarySports: ['strength'],
        currentFitnessLevel: 'fit',
        currentFatigue: 'normal',
        createdAt: '2026-04-01',
        updatedAt: '2026-04-01',
      },
    }

    mocks.sessionsStore.toArray.mockResolvedValue(sessions)
    mocks.dayLogsStore.toArray.mockResolvedValue(dayLogs)
    mocks.getAthleteProfileMock.mockResolvedValue(profile)

    const insights = await getAthleteProgressionInsights()

    expect(insights.matches).toHaveLength(1)
    expect(insights.matches[0].opponent).toBe('Rival A')
    expect(insights.squashRecommendation?.message).toContain('Familia')
    expect(insights.strengthRecommendation?.message).toContain('Patrón')
    expect(insights.strength[0].exerciseKey).toBe('sentadilla')
    expect(insights.squashWeeklyLoads[0].sessionsCount).toBeGreaterThanOrEqual(1)
    expect(insights.strengthWeeklyLoads[0].sessionsCount).toBeGreaterThanOrEqual(1)
  })
})
