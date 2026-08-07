import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../../db/db'
import type { Session, WhoopWorkout } from '../../../types'
import { setActiveAthleteId } from '../../athlete/activeAthlete'
import { loadWhoopWorkoutBlock } from '../whoopWorkoutBlock'

const SELF = 'self-1'
const MANAGED = 'managed-9'

// Lunes 2026-08-10. La semana del store empieza acá; el domingo 2026-08-09
// pertenece a la semana anterior.
const MONDAY = '2026-08-10'
const SUNDAY = '2026-08-09'

function makeWorkout(overrides: Partial<WhoopWorkout> & { workoutId: string }): WhoopWorkout {
  const date = overrides.date ?? SUNDAY
  return {
    id: `whoop:${overrides.athleteId ?? SELF}:${overrides.workoutId}`,
    athleteId: SELF,
    date,
    sportName: 'running',
    startAt: `${date}T10:00:00.000Z`,
    endAt: `${date}T10:30:00.000Z`,
    durationMin: 30,
    scoreState: 'SCORED',
    updatedAt: 1,
    ...overrides,
  }
}

function makeSession(overrides: Partial<Session> & { id: string }): Session {
  return {
    date: SUNDAY,
    timeBlock: 'AM',
    status: 'completed',
    title: 'Running Z2',
    durationMin: 60,
    type: 'running',
    athleteId: SELF,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Session
}

describe('loadWhoopWorkoutBlock', () => {
  beforeEach(async () => {
    await db.whoopWorkouts.clear()
    await db.sessions.clear()
    setActiveAthleteId(SELF)
  })

  afterEach(() => {
    setActiveAthleteId(null)
    vi.restoreAllMocks()
  })

  it('associates a Sunday workout with its session when today is Monday', async () => {
    // Este es el caso que un cálculo basado en el store rompería: la semana
    // cargada un lunes no contiene el domingo.
    await db.whoopWorkouts.add(makeWorkout({ workoutId: 'w-sunday' }))
    await db.sessions.add(makeSession({
      id: 's-sunday',
      autoCompletion: {
        source: 'whoop_workout',
        workoutId: 'w-sunday',
        completedAt: `${SUNDAY}T10:30:00.000Z`,
      },
    }))

    const block = await loadWhoopWorkoutBlock(SELF, MONDAY)

    expect(block).toContain('sesion planificada: Running Z2 60 min')
    expect(block).not.toContain('sin sesion asociada')
  })

  it('marks a Sunday workout as unassociated when no session claims it', async () => {
    await db.whoopWorkouts.add(makeWorkout({ workoutId: 'w-loose' }))
    await db.sessions.add(makeSession({ id: 's-other' }))

    const block = await loadWhoopWorkoutBlock(SELF, MONDAY)

    expect(block).toContain('sin sesion asociada')
  })

  it('returns null for a managed athlete even when the self has workouts', async () => {
    await db.whoopWorkouts.bulkAdd([
      makeWorkout({ workoutId: 'w1' }),
      makeWorkout({ workoutId: 'w2' }),
    ])

    expect(await loadWhoopWorkoutBlock(MANAGED, MONDAY)).toBeNull()
  })

  it('does not query sessions at all when there are no workouts', async () => {
    const spy = vi.spyOn(db.sessions, 'where')

    expect(await loadWhoopWorkoutBlock(SELF, MONDAY)).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
