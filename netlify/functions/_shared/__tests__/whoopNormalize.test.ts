import { describe, expect, it } from 'vitest'
import { READINESS_METRIC_CLEAR } from '../whoopSupabase'
import { normalizeWhoop, normalizeWorkouts } from '../whoopNormalize'

describe('normalizeWhoop', () => {
  it('maps recovery, sleep and cycle into per-day readiness', () => {
    const raw = {
      workouts: null,
      recovery: [{
        cycle_id: 101,
        sleep_id: 'sl-uuid',
        created_at: '2026-06-21T06:00:00Z',
        score: { recovery_score: 28, hrv_rmssd_milli: 41, resting_heart_rate: 52 },
      }],
      sleep: [{
        id: 's1',
        start: '2026-06-21T00:00:00Z',
        score: {
          stage_summary: { total_in_bed_time_milli: 18_720_000 },
          sleep_performance_percentage: 61,
        },
      }],
      cycles: [{
        id: 'c1',
        start: '2026-06-21T04:00:00Z',
        score: { strain: 14.1 },
      }],
    }

    const { readiness } = normalizeWhoop(raw)
    const day = readiness.find((row) => row.date === '2026-06-21')

    expect(day?.recoveryScore).toBe(28)
    expect(day?.hrvMs).toBe(41)
    expect(day?.rhrBpm).toBe(52)
    expect(day?.strain).toBe(14.1)
    expect(day?.sleepPerformance).toBe(61)
    expect(day?.sleepHours).toBeCloseTo(5.2, 1)
  })

  it('handles days with missing metrics', () => {
    const raw = {
      workouts: null,
      recovery: [],
      sleep: [{
        id: 's2',
        start: '2026-06-20T00:00:00Z',
        score: {
          stage_summary: { total_in_bed_time_milli: 25_200_000 },
          sleep_performance_percentage: 80,
        },
      }],
      cycles: [],
    }

    const { readiness } = normalizeWhoop(raw)
    const day = readiness.find((row) => row.date === '2026-06-20')

    expect(day?.recoveryScore ?? null).toBeNull()
    expect(day?.sleepHours).toBeCloseTo(7, 1)
  })

  it('produces raw biometric readings with rawId for dedupe', () => {
    const raw = {
      workouts: null,
      recovery: [{
        cycle_id: 101,
        sleep_id: 'sl-uuid',
        created_at: '2026-06-21T06:00:00Z',
        score: { recovery_score: 28 },
      }],
      sleep: [],
      cycles: [],
    }

    const { readings } = normalizeWhoop(raw)

    expect(readings.some((row) => row.metric === 'recovery' && row.rawId === '101' && row.value === 28)).toBe(true)
  })

  it('does not emit empty recovery metrics while WHOOP recovery is pending', () => {
    const raw = {
      workouts: null,
      recovery: [{
        cycle_id: 101,
        created_at: '2026-06-21T06:00:00Z',
        score_state: 'PENDING_SCORE',
        score: { recovery_score: null },
      }],
      sleep: [],
      cycles: [],
    }

    const { readiness, readings } = normalizeWhoop(raw)

    expect(readiness).toEqual([])
    expect(readings.some((row) => row.metric === 'recovery')).toBe(false)
  })

  it('emits explicit clears when WHOOP marks recovery as unscorable', () => {
    const raw = {
      workouts: null,
      recovery: [{
        cycle_id: 101,
        created_at: '2026-06-21T06:00:00Z',
        score_state: 'UNSCORABLE',
      }],
      sleep: [],
      cycles: [],
    }

    const { readiness, readings } = normalizeWhoop(raw)

    expect(readiness).toHaveLength(1)
    expect(readiness[0]).toMatchObject({ date: '2026-06-21' })
    expect(readiness[0].recoveryScore).toBe(READINESS_METRIC_CLEAR)
    expect(readiness[0].hrvMs).toBe(READINESS_METRIC_CLEAR)
    expect(readiness[0].rhrBpm).toBe(READINESS_METRIC_CLEAR)
    expect(readings.some((row) => row.metric === 'recovery')).toBe(false)
  })

  it('emits explicit clears for unscorable sleep and cycle scores', () => {
    const raw = {
      workouts: null,
      recovery: [],
      sleep: [{
        id: 'main-sleep',
        cycle_id: 101,
        end: '2026-06-21T10:00:00Z',
        score_state: 'UNSCORABLE',
        nap: false,
      }],
      cycles: [{
        id: 101,
        end: '2026-06-21T12:00:00Z',
        score_state: 'UNSCORABLE',
      }],
    }

    const { readiness } = normalizeWhoop(raw)

    expect(readiness).toHaveLength(1)
    expect(readiness[0].sleepHours).toBe(READINESS_METRIC_CLEAR)
    expect(readiness[0].sleepPerformance).toBe(READINESS_METRIC_CLEAR)
    expect(readiness[0].strain).toBe(READINESS_METRIC_CLEAR)
  })

  it('keeps scored metrics when a later unscorable record maps to the same day', () => {
    const raw = {
      workouts: null,
      recovery: [
        {
          cycle_id: 101,
          created_at: '2026-06-21T06:00:00Z',
          score_state: 'SCORED',
          score: { recovery_score: 74, hrv_rmssd_milli: 55, resting_heart_rate: 48 },
        },
        {
          cycle_id: 102,
          created_at: '2026-06-21T08:00:00Z',
          score_state: 'UNSCORABLE',
        },
      ],
      sleep: [
        {
          id: 'main-sleep',
          end: '2026-06-21T10:00:00Z',
          score_state: 'SCORED',
          nap: false,
          score: {
            stage_summary: { total_in_bed_time_milli: 28_800_000 },
            sleep_performance_percentage: 88,
          },
        },
        {
          id: 'unscorable-sleep',
          end: '2026-06-21T11:00:00Z',
          score_state: 'UNSCORABLE',
          nap: false,
        },
      ],
      cycles: [
        {
          id: 'cycle-scored',
          end: '2026-06-21T12:00:00Z',
          score_state: 'SCORED',
          score: { strain: 9.4 },
        },
        {
          id: 'cycle-unscorable',
          end: '2026-06-21T13:00:00Z',
          score_state: 'UNSCORABLE',
        },
      ],
    }

    const { readiness } = normalizeWhoop(raw)

    expect(readiness).toHaveLength(1)
    expect(readiness[0]).toMatchObject({
      date: '2026-06-21',
      recoveryScore: 74,
      hrvMs: 55,
      rhrBpm: 48,
      sleepHours: 8,
      sleepPerformance: 88,
      strain: 9.4,
    })
  })

  it('anchors recovery, sleep and strain to the same local cycle day', () => {
    const raw = {
      workouts: null,
      recovery: [{
        cycle_id: 101,
        created_at: '2026-06-21T11:00:00Z',
        timezone_offset: '-03:00',
        score: { recovery_score: 74, hrv_rmssd_milli: 55, resting_heart_rate: 48 },
      }],
      sleep: [{
        id: 'main-sleep',
        cycle_id: 101,
        start: '2026-06-20T23:30:00Z',
        end: '2026-06-21T07:30:00Z',
        timezone_offset: '-03:00',
        nap: false,
        score: {
          stage_summary: {
            total_in_bed_time_milli: 28_800_000,
            total_awake_time_milli: 1_800_000,
            total_no_data_time_milli: 0,
          },
          sleep_performance_percentage: 88,
        },
      }],
      cycles: [{
        id: 101,
        start: '2026-06-20T23:00:00Z',
        end: '2026-06-21T12:00:00Z',
        timezone_offset: '-03:00',
        score: { strain: 9.4 },
      }],
    }

    const { readiness } = normalizeWhoop(raw)

    expect(readiness).toHaveLength(1)
    expect(readiness[0]).toMatchObject({
      date: '2026-06-21',
      recoveryScore: 74,
      sleepHours: 7.5,
      sleepPerformance: 88,
      strain: 9.4,
    })
  })

  it('ignores naps and uses staged sleep duration when available', () => {
    const raw = {
      workouts: null,
      recovery: [],
      sleep: [
        {
          id: 'main-sleep',
          cycle_id: 101,
          end: '2026-06-21T10:00:00Z',
          timezone_offset: '-03:00',
          nap: false,
          score: {
            stage_summary: {
              total_in_bed_time_milli: 30_000_000,
              total_awake_time_milli: 6_000_000,
              total_light_sleep_time_milli: 12_000_000,
              total_slow_wave_sleep_time_milli: 7_200_000,
              total_rem_sleep_time_milli: 3_600_000,
            },
            sleep_performance_percentage: 82,
          },
        },
        {
          id: 'nap',
          cycle_id: 101,
          end: '2026-06-21T19:00:00Z',
          timezone_offset: '-03:00',
          nap: true,
          score: {
            stage_summary: { total_in_bed_time_milli: 1_800_000 },
            sleep_performance_percentage: 10,
          },
        },
      ],
      cycles: [{
        id: 101,
        end: '2026-06-21T12:00:00Z',
        timezone_offset: '-03:00',
        score: {},
      }],
    }

    const { readiness } = normalizeWhoop(raw)

    expect(readiness[0]?.sleepHours).toBeCloseTo(6.3, 1)
    expect(readiness[0]?.sleepPerformance).toBe(82)
  })
})

const emptyRaw = { recovery: [], sleep: [], cycles: [], workouts: [] }

function makeRawWorkout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w-1',
    sport_name: 'running',
    start: '2026-07-09T14:00:00.000Z',
    end: '2026-07-09T14:45:00.000Z',
    timezone_offset: '-04:00',
    score_state: 'SCORED',
    score: { strain: 10.5, average_heart_rate: 140, max_heart_rate: 172, kilojoule: 1200 },
    ...overrides,
  }
}

describe('normalizeWorkouts', () => {
  it('normalizes a scored workout with duration and local date', () => {
    expect(normalizeWorkouts({ ...emptyRaw, workouts: [makeRawWorkout()] })).toEqual([{
      workoutId: 'w-1',
      date: '2026-07-09',
      sportName: 'running',
      startAt: '2026-07-09T14:00:00.000Z',
      endAt: '2026-07-09T14:45:00.000Z',
      durationMin: 45,
      strain: 10.5,
      avgHr: 140,
      maxHr: 172,
      distanceM: null,
      scoreState: 'SCORED',
    }])
  })

  it('anchors date to start plus timezone offset across midnight', () => {
    const rows = normalizeWorkouts({
      ...emptyRaw,
      workouts: [makeRawWorkout({
        start: '2026-07-10T02:00:00.000Z',
        end: '2026-07-10T03:00:00.000Z',
        timezone_offset: '-05:00',
      })],
    })
    expect(rows[0]?.date).toBe('2026-07-09')
  })

  it('keeps pending workouts without score metrics', () => {
    const rows = normalizeWorkouts({
      ...emptyRaw,
      workouts: [makeRawWorkout({ score_state: 'PENDING_SCORE', score: undefined })],
    })
    expect(rows[0]?.scoreState).toBe('PENDING_SCORE')
    expect(rows[0]?.strain).toBeNull()
  })

  it('normalizes sport casing and separators', () => {
    const rows = normalizeWorkouts({
      ...emptyRaw,
      workouts: [makeRawWorkout({ sport_name: '  Functional_Fitness ' })],
    })
    expect(rows[0]?.sportName).toBe('functional fitness')
  })

  it('drops malformed records', () => {
    const rows = normalizeWorkouts({
      ...emptyRaw,
      workouts: [
        makeRawWorkout({ id: undefined }),
        makeRawWorkout({ start: 'not-a-date' }),
        makeRawWorkout({ end: '2026-07-09T13:00:00.000Z' }),
        'garbage',
      ],
    })
    expect(rows).toEqual([])
  })

  it('sorts by startAt and then workoutId', () => {
    const rows = normalizeWorkouts({
      ...emptyRaw,
      workouts: [
        makeRawWorkout({ id: 'b', start: '2026-07-09T18:00:00.000Z', end: '2026-07-09T19:00:00.000Z' }),
        makeRawWorkout({ id: 'a', start: '2026-07-09T14:00:00.000Z', end: '2026-07-09T15:00:00.000Z' }),
      ],
    })
    expect(rows.map((row) => row.workoutId)).toEqual(['a', 'b'])
  })
})
