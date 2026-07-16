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

  it('keeps a completed cycle on its waking day when the user fell asleep after midnight', () => {
    // Real-world incident (2026-07-16): WHOOP cycles run from sleep onset to the
    // next sleep onset, so when the user falls asleep past local midnight the
    // completed cycle's `end` lands on the NEXT calendar day. Anchoring by `end`
    // shifted the whole Jul-15 cycle onto Jul-16, overwriting today's real data.
    // Records arrive newest-first, like the WHOOP API returns them.
    const raw = {
      workouts: null,
      recovery: [
        {
          cycle_id: 1016,
          sleep_id: 'sleep-16',
          created_at: '2026-07-16T11:30:00Z',
          timezone_offset: '-04:00',
          score_state: 'SCORED',
          score: { recovery_score: 55, hrv_rmssd_milli: 48, resting_heart_rate: 60 },
        },
        {
          cycle_id: 1015,
          sleep_id: 'sleep-15',
          created_at: '2026-07-15T12:00:00Z',
          timezone_offset: '-04:00',
          score_state: 'SCORED',
          score: { recovery_score: 78, hrv_rmssd_milli: 60.24, resting_heart_rate: 55 },
        },
      ],
      sleep: [
        {
          id: 'sleep-16',
          cycle_id: 1016,
          start: '2026-07-16T04:30:00Z',
          end: '2026-07-16T11:00:00Z',
          timezone_offset: '-04:00',
          nap: false,
          score_state: 'SCORED',
          score: {
            stage_summary: {
              total_light_sleep_time_milli: 13_000_000,
              total_slow_wave_sleep_time_milli: 6_200_000,
              total_rem_sleep_time_milli: 4_200_000,
            },
            sleep_performance_percentage: 70,
          },
        },
        {
          id: 'sleep-15',
          cycle_id: 1015,
          start: '2026-07-15T04:30:00Z',
          end: '2026-07-15T11:30:00Z',
          timezone_offset: '-04:00',
          nap: false,
          score_state: 'SCORED',
          score: {
            stage_summary: {
              total_light_sleep_time_milli: 14_000_000,
              total_slow_wave_sleep_time_milli: 6_000_000,
              total_rem_sleep_time_milli: 4_840_000,
            },
            sleep_performance_percentage: 82,
          },
        },
      ],
      cycles: [
        {
          // Current cycle: started at last night's 00:30 local sleep onset, no end yet.
          id: 1016,
          start: '2026-07-16T04:30:00Z',
          created_at: '2026-07-16T04:30:00Z',
          timezone_offset: '-04:00',
          score_state: 'SCORED',
          score: { strain: 3.2 },
        },
        {
          // Yesterday's cycle: ends at the next sleep onset, 00:30 local on Jul 16.
          id: 1015,
          start: '2026-07-15T04:30:00Z',
          end: '2026-07-16T04:30:00Z',
          created_at: '2026-07-15T04:30:00Z',
          timezone_offset: '-04:00',
          score_state: 'SCORED',
          score: { strain: 4.5 },
        },
      ],
    }

    const { readiness } = normalizeWhoop(raw)

    expect(readiness.map((row) => row.date)).toEqual(['2026-07-15', '2026-07-16'])
    expect(readiness[0]).toMatchObject({
      date: '2026-07-15',
      recoveryScore: 78,
      strain: 4.5,
      sleepHours: 6.9,
      sleepPerformance: 82,
    })
    expect(readiness[1]).toMatchObject({
      date: '2026-07-16',
      recoveryScore: 55,
      strain: 3.2,
      sleepHours: 6.5,
      sleepPerformance: 70,
    })
  })

  it('anchors a completed cycle without sleep records to the waking day, not the next bedtime day', () => {
    const raw = {
      workouts: null,
      recovery: [],
      sleep: [],
      cycles: [{
        id: 1015,
        start: '2026-07-15T04:30:00Z',
        end: '2026-07-16T04:30:00Z',
        timezone_offset: '-04:00',
        score_state: 'SCORED',
        score: { strain: 4.5 },
      }],
    }

    const { readiness } = normalizeWhoop(raw)

    expect(readiness).toHaveLength(1)
    expect(readiness[0]).toMatchObject({ date: '2026-07-15', strain: 4.5 })
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
