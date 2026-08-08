import { describe, it, expect } from 'vitest'
import type { WhoopWorkout } from '../../../types'
import { buildWeeklyHrZoneSummary } from '../weeklyHrZones'

const WEEK = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']
const ZONES = { z0: 0, z1: 0, z2: 600_000, z3: 300_000, z4: 500_000, z5: 100_000 }

function makeWorkout(overrides: Partial<WhoopWorkout> = {}): WhoopWorkout {
  return {
    id: 'x', workoutId: 'x', athleteId: 'ath-1', date: '2026-08-04',
    sportName: 'squash', startAt: '2026-08-04T10:00:00.000Z',
    endAt: '2026-08-04T11:00:00.000Z', durationMin: 60,
    scoreState: 'SCORED' as const, updatedAt: 1, zoneDurations: ZONES,
    ...overrides,
  }
}

describe('buildWeeklyHrZoneSummary', () => {
  it('devuelve null si ningún entrenamiento de la semana tiene zonas', () => {
    expect(buildWeeklyHrZoneSummary([makeWorkout({ zoneDurations: undefined })], WEEK)).toBeNull()
    expect(buildWeeklyHrZoneSummary([], WEEK)).toBeNull()
  })

  it('excluye de TODA cifra los workouts sin zonas o no SCORED', () => {
    const summary = buildWeeklyHrZoneSummary([
      makeWorkout({ workoutId: 'a' }),
      makeWorkout({ workoutId: 'b', zoneDurations: undefined }),
      makeWorkout({ workoutId: 'c', scoreState: 'PENDING_SCORE' }),
    ], WEEK)!
    expect(summary.workoutCount).toBe(1)
  })

  it('devuelve siempre siete días en orden, incluidos los vacíos', () => {
    const summary = buildWeeklyHrZoneSummary([makeWorkout()], WEEK)!
    expect(summary.days.map((day) => day.date)).toEqual(WEEK)
    expect(summary.days[0].totalMs).toBe(0)
    expect(summary.days[1].totalMs).toBe(1_500_000)
  })

  it('suma por zona los entrenamientos del mismo día', () => {
    const summary = buildWeeklyHrZoneSummary([
      makeWorkout({ workoutId: 'a' }),
      makeWorkout({ workoutId: 'b' }),
    ], WEEK)!
    expect(summary.days[1].byZone.z2).toBe(1_200_000)
    expect(summary.highZoneMs).toBe(1_200_000)
  })

  it('los minutos registrados salen de la suma de zonas, no de durationMin', () => {
    // durationMin dice 60; las zonas suman 25 min. Gana la suma de zonas para
    // que titular y columnas no puedan discrepar.
    const summary = buildWeeklyHrZoneSummary([makeWorkout()], WEEK)!
    expect(summary.totalRecordedMs).toBe(1_500_000)
  })

  it('cuenta cobertura baja y no informada por separado', () => {
    const summary = buildWeeklyHrZoneSummary([
      makeWorkout({ workoutId: 'a', percentRecorded: 72.4 }),
      makeWorkout({ workoutId: 'b' }),
      makeWorkout({ workoutId: 'c', percentRecorded: 99 }),
      makeWorkout({ workoutId: 'd', percentRecorded: 100 }),
    ], WEEK)!
    expect(summary.lowCaptureCount).toBe(1)
    expect(summary.unknownCaptureCount).toBe(1)
  })

  it('ignora entrenamientos fuera de la semana visible', () => {
    const summary = buildWeeklyHrZoneSummary([
      makeWorkout({ workoutId: 'a' }),
      makeWorkout({ workoutId: 'b', date: '2026-07-30' }),
    ], WEEK)!
    expect(summary.workoutCount).toBe(1)
  })
})
