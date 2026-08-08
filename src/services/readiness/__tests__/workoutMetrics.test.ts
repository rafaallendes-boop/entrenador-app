import { describe, it, expect } from 'vitest'
import type { WhoopWorkout } from '../../../types'
import {
  buildWorkoutMetrics,
  resolvePaceSecondsPerKm,
  resolveScoreNotice,
  resolveHighZoneDurationMs,
  resolveHrCaptureState,
  formatHrCapturePercent,
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

const ZONES = { z0: 60_000, z1: 120_000, z2: 600_000, z3: 900_000, z4: 700_000, z5: 200_000 }

describe('resolveHighZoneDurationMs', () => {
  it('suma z4 + z5 en milisegundos, sin redondear', () => {
    expect(resolveHighZoneDurationMs(makeWorkout({ zoneDurations: ZONES }))).toBe(900_000)
  })

  it('devuelve null sin distribución', () => {
    expect(resolveHighZoneDurationMs(makeWorkout())).toBeNull()
  })

  it('devuelve 0 cuando z4 y z5 son cero: cero medido no es ausencia', () => {
    expect(resolveHighZoneDurationMs(
      makeWorkout({ zoneDurations: { ...ZONES, z4: 0, z5: 0 } }),
    )).toBe(0)
  })
})

describe('resolveHrCaptureState', () => {
  it('devuelve null si no hay distribución, aunque haya cobertura', () => {
    expect(resolveHrCaptureState(makeWorkout({ percentRecorded: 72.4 }))).toBeNull()
  })

  it('devuelve unknown con distribución y sin cobertura', () => {
    expect(resolveHrCaptureState(makeWorkout({ zoneDurations: ZONES }))).toEqual({ kind: 'unknown' })
  })

  it.each([
    [100, { kind: 'full' }],
    [100.0, { kind: 'full' }],
    [99.9, { kind: 'high', percent: 99.9 }],
    [90, { kind: 'high', percent: 90 }],
    [89.96, { kind: 'low', percent: 89.96 }],
    [0, { kind: 'low', percent: 0 }],
  ])('clasifica %s con el valor crudo', (percentRecorded, expected) => {
    expect(resolveHrCaptureState(makeWorkout({ zoneDurations: ZONES, percentRecorded })))
      .toEqual(expected)
  })
})

describe('formatHrCapturePercent', () => {
  it('trunca a un decimal en vez de redondear', () => {
    // Redondear 89.96 daría 90,0 junto a un aviso de cobertura baja.
    expect(formatHrCapturePercent(89.96, ',')).toBe('89,9')
  })

  it('respeta el separador pedido', () => {
    expect(formatHrCapturePercent(72.45, '.')).toBe('72.4')
    expect(formatHrCapturePercent(72.45, ',')).toBe('72,4')
  })

  it('no deja decimal colgando en enteros', () => {
    expect(formatHrCapturePercent(90, ',')).toBe('90')
  })
})
