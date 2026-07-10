import { describe, expect, it } from 'vitest'

import type { WeekSummary } from '../../types'
import {
  buildWeeklyCoachNoteSnapshot,
  getFreshWeeklyCoachNote,
  hasFreshWeeklyCoachNote,
} from '../weeklyCoachNote'

function makeSummary(partial: Partial<WeekSummary> = {}): WeekSummary {
  return {
    id: 'week-1',
    weekStartDate: '2026-07-06',
    totalSessions: 8,
    totalMinutes: 360,
    plannedSessions: 8,
    completedSessions: 6,
    plannedMinutes: 360,
    completedMinutes: 275,
    adherencePct: 75,
    squashSessions: 3,
    runningSessions: 1,
    strengthSessions: 1,
    plannedSquashSessions: 4,
    plannedRunningSessions: 2,
    plannedStrengthSessions: 2,
    ...partial,
  }
}

describe('weekly coach note freshness', () => {
  it('accepts a coach note only when its snapshot matches the current weekly summary', () => {
    const summary = makeSummary({ coachNote: 'Buena semana.' })
    const snapshot = buildWeeklyCoachNoteSnapshot(summary)

    expect(hasFreshWeeklyCoachNote({ ...summary, coachNoteSnapshot: snapshot })).toBe(true)
    expect(getFreshWeeklyCoachNote({ ...summary, coachNoteSnapshot: snapshot })).toBe('Buena semana.')
  })

  it('treats legacy notes without a snapshot as stale', () => {
    expect(hasFreshWeeklyCoachNote(makeSummary({ coachNote: 'Nota antigua.' }))).toBe(false)
    expect(getFreshWeeklyCoachNote(makeSummary({ coachNote: 'Nota antigua.' }))).toBeNull()
  })

  it('treats the note as stale when weekly completion changes after generation', () => {
    const generatedAgainst = makeSummary({ coachNote: 'Aun falta cerrar sesiones.' })
    const snapshot = buildWeeklyCoachNoteSnapshot(generatedAgainst)
    const updated = makeSummary({
      coachNote: generatedAgainst.coachNote,
      coachNoteSnapshot: snapshot,
      completedSessions: 7,
      completedMinutes: 320,
      adherencePct: 88,
    })

    expect(hasFreshWeeklyCoachNote(updated)).toBe(false)
  })
})
