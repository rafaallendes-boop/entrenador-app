import { describe, expect, it } from 'vitest'

import { extractRecentSquashKinds, planSquashWeek } from '../training/squashWeekPlanner'
import type { Session } from '../../types'

function makeSquashSession(date: string, sessionKind: NonNullable<Session['squashDetails']>['sessionKind']): Session {
  return {
    id: `${date}-${sessionKind}`,
    date,
    timeBlock: 'AM',
    type: 'squash',
    status: 'completed',
    subtype: sessionKind === 'match' ? 'match' : 'training',
    title: 'Squash',
    durationMin: 60,
    createdAt: 1,
    updatedAt: 1,
    squashDetails: {
      trainingFocus: sessionKind === 'shadows' ? 'physical' : 'technical',
      sessionKind,
      sessionMode: sessionKind === 'match' ? 'practice_match' : 'drill_session',
      drills: [{ name: sessionKind === 'shadows' ? 'Ghosting 4 esquinas' : sessionKind === 'control' ? '100 drops solo' : 'Drives paralelos a profundidad', durationMin: 20 }],
    },
  } as Session
}

describe('squashWeekPlanner', () => {
  it('returns the expected build pattern for 4 slots', () => {
    const plan = planSquashWeek({
      sessionSlots: 4,
      phase: 'build',
      recentKinds: ['technical', 'control'],
      fatigueLevel: 4,
    })

    expect(plan.slots.map((slot) => slot.kind)).toEqual(['technical', 'shadows', 'control', 'match'])
  })

  it('forces the last slot to control when competition is very near', () => {
    const plan = planSquashWeek({
      sessionSlots: 3,
      phase: 'peak',
      daysToNextCompetition: 2,
      recentKinds: ['technical', 'match'],
      fatigueLevel: 4,
    })

    expect(plan.slots[plan.slots.length - 1]?.kind).toBe('control')
  })

  it('replaces higher-cost work when squash ACWR is in risk', () => {
    const plan = planSquashWeek({
      sessionSlots: 3,
      phase: 'build',
      recentKinds: ['match', 'technical'],
      fatigueLevel: 4,
      squashAcwr: { sport: 'squash', acuteLoad: 800, chronicLoad: 500, ratio: 1.6, status: 'risk', baselineWeeks: 3 },
    })

    expect(plan.slots.some((slot) => slot.kind === 'match')).toBe(false)
    expect(plan.slots.some((slot) => slot.kind === 'control')).toBe(true)
  })

  it('extracts recent session kinds from squash history', () => {
    const kinds = extractRecentSquashKinds([
      makeSquashSession('2026-04-11', 'control'),
      makeSquashSession('2026-04-10', 'shadows'),
      makeSquashSession('2026-04-09', 'technical'),
    ])

    expect(kinds).toEqual(['control', 'shadows', 'technical'])
  })
})
