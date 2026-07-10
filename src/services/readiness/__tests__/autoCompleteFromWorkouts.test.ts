import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, WhoopWorkout } from '../../../types'

vi.mock('../../syncService', () => ({
  pushSession: vi.fn(async () => {}),
  pushWeekSummary: vi.fn(async () => {}),
  pushDayLog: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
}))

import { db } from '../../../db/db'
import {
  bumpSwitchEpoch,
  setActiveAthleteId,
  setSelfAthleteId,
} from '../../athlete/activeAthlete'
import { useTrainingStore } from '../../../store/useTrainingStore'
import { autoCompleteFromWorkouts } from '../autoCompleteFromWorkouts'
import { WHOOP_WORKOUT_WINDOW_DAYS } from '../pullWorkouts'

const SELF = 'ath_self'
const TODAY = new Date().toISOString().slice(0, 10)

function makeSession(partial: Partial<Session> = {}): Session {
  return {
    id: partial.id ?? 's-1',
    athleteId: SELF,
    date: partial.date ?? TODAY,
    timeBlock: 'AM',
    type: partial.type ?? 'squash',
    status: partial.status ?? 'planned',
    title: 'Sesion',
    durationMin: 60,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  } as Session
}

function makeWorkout(partial: Partial<WhoopWorkout> = {}): WhoopWorkout {
  const workoutId = partial.workoutId ?? 'w-1'
  return {
    id: `whoop:${SELF}:${workoutId}`,
    workoutId,
    athleteId: SELF,
    date: TODAY,
    sportName: 'squash',
    startAt: `${TODAY}T14:00:00.000Z`,
    endAt: `${TODAY}T14:48:00.000Z`,
    durationMin: 48,
    scoreState: 'SCORED',
    updatedAt: 1,
    ...partial,
  }
}

describe('autoCompleteFromWorkouts', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId(SELF)
    setActiveAthleteId(SELF)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('completes the single planned session of the same sport and day', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())

    await autoCompleteFromWorkouts()

    const session = await db.sessions.get('s-1')
    expect(session).toMatchObject({
      status: 'completed',
      actualDurationMin: 48,
      autoCompletion: { source: 'whoop_workout', workoutId: 'w-1' },
    })
    expect(session?.actualRpe).toBeUndefined()
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete)
      .toMatchObject({ status: 'completed', sessionId: 's-1' })
  })

  it('adds a recent-workout note without overwriting manual notes', async () => {
    await db.sessions.bulkPut([
      makeSession({ id: 's-1' }),
      makeSession({ id: 'manual', type: 'running', completionNotes: 'nota manual' }),
    ])
    await db.whoopWorkouts.bulkPut([
      makeWorkout(),
      makeWorkout({ workoutId: 'run', sportName: 'running', startAt: `${TODAY}T15:00:00.000Z` }),
    ])

    await autoCompleteFromWorkouts()

    expect((await db.sessions.get('s-1'))?.completionNotes).toContain('Whoop: ultimos entrenamientos:')
    expect((await db.sessions.get('manual'))?.completionNotes).toBe('nota manual')
  })

  it.each([
    [{ durationMin: 12, endAt: `${TODAY}T14:12:00.000Z` }, 'skipped_short'],
    [{ sportName: 'tennis' }, 'unmapped_sport'],
  ] as const)('marks terminal non-matches', async (override, status) => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout(override))
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete?.status).toBe(status)
  })

  it('treats an exact 14:59 workout as shorter than 15 minutes despite rounded durationMin', async () => {
    const startAt = `${TODAY}T14:00:00.000Z`
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout({
      startAt,
      endAt: new Date(Date.parse(startAt) + (15 * 60_000) - 1_000).toISOString(),
      durationMin: 15,
    }))
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete?.status).toBe('skipped_short')
  })

  it('marks multiple planned candidates as skipped_multiple', async () => {
    await db.sessions.bulkPut([makeSession(), makeSession({ id: 's-2' })])
    await db.whoopWorkouts.put(makeWorkout())
    await autoCompleteFromWorkouts()
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete?.status)
      .toBe('skipped_multiple')
  })

  it('re-evaluates no_session when a session appears later', async () => {
    await db.whoopWorkouts.put(makeWorkout())
    await autoCompleteFromWorkouts()
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete?.status).toBe('no_session')

    await db.sessions.put(makeSession())
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.status).toBe('completed')
  })

  it('uses the durable session marker even after a manual revert and date move', async () => {
    const otherDay = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
    await db.sessions.bulkPut([
      makeSession({
        date: otherDay,
        status: 'planned',
        autoCompletion: {
          source: 'whoop_workout',
          workoutId: 'w-1',
          completedAt: '2026-07-09T15:00:00.000Z',
        },
      }),
      makeSession({ id: 's-2' }),
    ])
    await db.whoopWorkouts.put(makeWorkout())

    await autoCompleteFromWorkouts()

    expect((await db.sessions.get('s-2'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete).toBeUndefined()
  })

  it('does nothing outside self scope', async () => {
    setActiveAthleteId('ath_managed')
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
  })

  it('processes workouts deterministically and serializes concurrent runs', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.bulkPut([
      makeWorkout({ workoutId: 'w-2', startAt: `${TODAY}T18:00:00.000Z` }),
      makeWorkout({ workoutId: 'w-1', startAt: `${TODAY}T10:00:00.000Z` }),
    ])
    await Promise.all([autoCompleteFromWorkouts(), autoCompleteFromWorkouts()])
    expect((await db.sessions.get('s-1'))?.autoCompletion?.workoutId).toBe('w-1')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-2`))?.autoComplete?.status).toBe('no_session')
  })

  it('does not mark completed when updateSession has no effect', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())
    vi.spyOn(useTrainingStore.getState(), 'updateSession').mockResolvedValue(undefined)

    await autoCompleteFromWorkouts()

    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete?.status).not.toBe('completed')
  })

  it('isolates a per-workout failure and continues the batch', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.bulkPut([
      makeWorkout({ workoutId: 'bad', sportName: 'tennis', startAt: `${TODAY}T09:00:00.000Z` }),
      makeWorkout({ workoutId: 'good', startAt: `${TODAY}T10:00:00.000Z` }),
    ])
    vi.spyOn(db.whoopWorkouts, 'update').mockImplementationOnce(async () => {
      throw new Error('dexie down')
    })
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.autoCompletion?.workoutId).toBe('good')
  })

  it('aborts if the athlete switches during the candidate read', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())
    const realWhere = db.sessions.where.bind(db.sessions)
    vi.spyOn(db.sessions, 'where').mockImplementationOnce((index: unknown) => {
      bumpSwitchEpoch()
      setActiveAthleteId('ath_managed')
      return realWhere(index as never)
    })
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete).toBeUndefined()
  })

  it('aborts before building the durable set if the athlete switches during the marker read', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())
    const realFilter = db.sessions.filter.bind(db.sessions)
    vi.spyOn(db.sessions, 'filter').mockImplementationOnce((fn: (session: Session) => boolean) => {
      bumpSwitchEpoch()
      setActiveAthleteId('ath_managed')
      return realFilter(fn)
    })
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete).toBeUndefined()
  })

  it('does not mark telemetry when the athlete switches during updateSession', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())
    const realUpdate = useTrainingStore.getState().updateSession
    vi.spyOn(useTrainingStore.getState(), 'updateSession').mockImplementation(async (id, patch) => {
      await realUpdate(id, patch)
      bumpSwitchEpoch()
      setActiveAthleteId('ath_managed')
    })
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.status).toBe('completed')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete).toBeUndefined()
  })

  it('ignores workouts before the cutoff instant even on the cutoff date', async () => {
    const cutoffMs = Date.now() - WHOOP_WORKOUT_WINDOW_DAYS * 86_400_000
    const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10)
    await db.sessions.put(makeSession({ date: cutoffDate }))
    await db.whoopWorkouts.put(makeWorkout({
      date: cutoffDate,
      startAt: new Date(cutoffMs - 3_600_000).toISOString(),
      endAt: new Date(cutoffMs - 3_600_000 + 48 * 60_000).toISOString(),
    }))
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete).toBeUndefined()
  })
})
