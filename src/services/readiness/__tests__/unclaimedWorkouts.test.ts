import { describe, it, expect } from 'vitest'
import type { Session, WhoopWorkout } from '../../../types'
import { canResolveWorkoutClaims, selectUnclaimedWorkouts } from '../unclaimedWorkouts'

function makeWorkout(workoutId: string): WhoopWorkout {
  return {
    id: `whoop:self-1:${workoutId}`,
    workoutId,
    athleteId: 'self-1',
    date: '2026-08-04',
    sportName: 'running',
    startAt: '2026-08-04T10:00:00.000Z',
    endAt: '2026-08-04T10:30:00.000Z',
    durationMin: 30,
    scoreState: 'SCORED',
    updatedAt: 1,
  }
}

function makeSession(id: string, workoutId?: string): Session {
  return {
    id,
    date: '2026-08-04',
    timeBlock: 'AM',
    status: 'completed',
    title: 'Running Z2',
    durationMin: 60,
    type: 'running',
    createdAt: 1,
    updatedAt: 1,
    ...(workoutId
      ? {
          autoCompletion: {
            source: 'whoop_workout',
            workoutId,
            completedAt: '2026-08-04T10:30:00.000Z',
          },
        }
      : {}),
  } as Session
}

describe('selectUnclaimedWorkouts', () => {
  it('returns every workout when no session claims one', () => {
    const workouts = [makeWorkout('w1'), makeWorkout('w2')]
    const result = selectUnclaimedWorkouts(workouts, [makeSession('s1')])
    expect(result.map((row) => row.workoutId)).toEqual(['w1', 'w2'])
  })

  it('returns an empty list when every workout is claimed', () => {
    const workouts = [makeWorkout('w1'), makeWorkout('w2')]
    const sessions = [makeSession('s1', 'w1'), makeSession('s2', 'w2')]
    expect(selectUnclaimedWorkouts(workouts, sessions)).toEqual([])
  })

  it('returns only the unclaimed subset', () => {
    const workouts = [makeWorkout('w1'), makeWorkout('w2'), makeWorkout('w3')]
    const result = selectUnclaimedWorkouts(workouts, [makeSession('s1', 'w2')])
    expect(result.map((row) => row.workoutId)).toEqual(['w1', 'w3'])
  })

  it('lets the session side win over the workout-side status', () => {
    // `types/index.ts:493-494`: `workout.autoComplete` es estado local y la
    // fuente durable es `session.autoCompletion.workoutId`. Un workout que se
    // cree no matcheado pero al que una sesión reclama NO es no asociado.
    const claimed: WhoopWorkout = {
      ...makeWorkout('w1'),
      autoComplete: { status: 'no_session', processedAt: 1 },
    }
    expect(selectUnclaimedWorkouts([claimed], [makeSession('s1', 'w1')])).toEqual([])
  })

  it('ignores sessions whose autoCompletion is absent or from another source', () => {
    const workouts = [makeWorkout('w1')]
    const manual = makeSession('s1')
    expect(selectUnclaimedWorkouts(workouts, [manual])).toHaveLength(1)
  })
})

describe('canResolveWorkoutClaims', () => {
  // 2026-08-04 es martes; su semana empieza el lunes 2026-08-03.
  const TUESDAY = '2026-08-04'
  const ITS_MONDAY = '2026-08-03'

  it('resuelve cuando la semana cargada contiene el día', () => {
    expect(canResolveWorkoutClaims(TUESDAY, ITS_MONDAY)).toBe(true)
  })

  it('no resuelve antes de que el store cargue una semana', () => {
    // Este es el estado real al entrar directo a /day/:date: `sessions` está
    // vacío y todo workout parecería no asociado.
    expect(canResolveWorkoutClaims(TUESDAY, null)).toBe(false)
  })

  it('no resuelve mientras la semana cargada es otra', () => {
    expect(canResolveWorkoutClaims(TUESDAY, '2026-07-27')).toBe(false)
  })

  it('no resuelve sin fecha en la ruta', () => {
    expect(canResolveWorkoutClaims('', ITS_MONDAY)).toBe(false)
  })

  it('resuelve en los dos bordes de la semana', () => {
    expect(canResolveWorkoutClaims(ITS_MONDAY, ITS_MONDAY)).toBe(true)
    expect(canResolveWorkoutClaims('2026-08-09', ITS_MONDAY)).toBe(true)   // domingo
    expect(canResolveWorkoutClaims('2026-08-10', ITS_MONDAY)).toBe(false)  // lunes siguiente
  })
})
