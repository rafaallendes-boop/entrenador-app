import { describe, it, expect } from 'vitest'
import type { WhoopWorkout } from '../../../types'
import {
  buildWorkoutMetrics,
  resolvePaceSecondsPerKm,
  resolveScoreNotice,
} from '../workoutMetrics'

function makeWorkout(overrides: Partial<WhoopWorkout> = {}): WhoopWorkout {
  return {
    id: 'whoop:athlete-1:w1',
    workoutId: 'w1',
    athleteId: 'athlete-1',
    date: '2026-08-04',
    sportName: 'running',
    startAt: '2026-08-04T10:00:00.000Z',
    endAt: '2026-08-04T10:30:00.000Z',
    durationMin: 30,
    scoreState: 'SCORED',
    updatedAt: 1,
    ...overrides,
  }
}

describe('resolvePaceSecondsPerKm', () => {
  it('computes pace from the exact timestamps', () => {
    // 30 min exactos sobre 5 km => 360 s/km
    const pace = resolvePaceSecondsPerKm(makeWorkout({ distanceM: 5000 }))
    expect(pace).toBeCloseTo(360, 6)
  })

  it('uses the exact duration, not the rounded durationMin', () => {
    // 30 min 40 s reales = 1840 s. durationMin redondea a 31 (1860 s).
    const workout = makeWorkout({
      endAt: '2026-08-04T10:30:40.000Z',
      durationMin: 31,
      distanceM: 5000,
    })
    const pace = resolvePaceSecondsPerKm(workout)
    expect(pace).toBeCloseTo(368, 6)       // 1840 / 5
    expect(pace).not.toBeCloseTo(372, 6)   // lo que daría durationMin
  })

  it('returns null below the 300 m floor', () => {
    expect(resolvePaceSecondsPerKm(makeWorkout({ distanceM: 299 }))).toBeNull()
  })

  it('returns null when distance is absent', () => {
    expect(resolvePaceSecondsPerKm(makeWorkout())).toBeNull()
  })

  it('returns null when the exact duration is not positive', () => {
    const workout = makeWorkout({
      endAt: '2026-08-04T10:00:00.000Z',
      distanceM: 5000,
    })
    expect(resolvePaceSecondsPerKm(workout)).toBeNull()
  })

  it('returns null when timestamps do not parse', () => {
    const workout = makeWorkout({ startAt: 'not-a-date', distanceM: 5000 })
    expect(resolvePaceSecondsPerKm(workout)).toBeNull()
  })

  it.each(['cycling', 'walking', 'squash'])(
    'returns null for %s even with valid distance and duration',
    (sportName) => {
      expect(resolvePaceSecondsPerKm(makeWorkout({ sportName, distanceM: 5000 }))).toBeNull()
    },
  )
})

describe('buildWorkoutMetrics', () => {
  it('emits every metric when the data is complete', () => {
    const metrics = buildWorkoutMetrics(makeWorkout({
      strain: 11.2,
      avgHr: 148,
      maxHr: 172,
      distanceM: 5000,
    }))

    expect(metrics).toEqual([
      { key: 'strain', value: 11.2 },
      { key: 'duration', value: 30 },
      { key: 'hr', value: { avg: 148, max: 172 } },
      { key: 'distance', value: 5000 },
      { key: 'pace', value: 360 },
    ])
  })

  it('emits hr with a null max when maxHr is absent', () => {
    const metrics = buildWorkoutMetrics(makeWorkout({ avgHr: 148 }))
    expect(metrics).toContainEqual({ key: 'hr', value: { avg: 148, max: null } })
  })

  it('omits absent metrics instead of emitting placeholders', () => {
    const metrics = buildWorkoutMetrics(makeWorkout())
    expect(metrics).toEqual([{ key: 'duration', value: 30 }])
  })

  it('keeps distance but drops pace below the floor', () => {
    const metrics = buildWorkoutMetrics(makeWorkout({ distanceM: 250 }))
    expect(metrics).toContainEqual({ key: 'distance', value: 250 })
    expect(metrics.some((metric) => metric.key === 'pace')).toBe(false)
  })
})

describe('resolveScoreNotice', () => {
  it('distinguishes the transient state from the terminal one', () => {
    expect(resolveScoreNotice(makeWorkout({ scoreState: 'PENDING_SCORE' }))).toBe('pending')
    expect(resolveScoreNotice(makeWorkout({ scoreState: 'UNSCORABLE' }))).toBe('unscorable')
  })

  it('stays silent for a scored workout with missing metrics', () => {
    expect(resolveScoreNotice(makeWorkout())).toBeNull()
  })
})
