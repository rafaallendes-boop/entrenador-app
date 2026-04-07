import { addDays, subWeeks } from 'date-fns'
import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import { toISO, getWeekStart } from '../../utils/date'
import {
  calculateRunningAcwr,
  calculateSquashAcwr,
  calculateStrengthAcwr,
  computeAcwrByDiscipline,
  getRunningWeeklyLoads,
  getSquashWeeklyLoads,
  getStrengthWeeklyLoads,
  type WeekLoadSummary,
} from '../loadAnalytics'

function weekStartISO(weeksAgo: number): string {
  return toISO(getWeekStart(subWeeks(new Date(), weeksAgo)))
}

function dateInWeek(weeksAgo: number, dayOffset = 0): string {
  const monday = getWeekStart(subWeeks(new Date(), weeksAgo))
  return toISO(addDays(monday, dayOffset))
}

let idSeq = 0
function makeSession(overrides: Partial<Session> & { type: Session['type'] }): Session {
  idSeq += 1
  return {
    id: `test-${idSeq}`,
    date: dateInWeek(0),
    timeBlock: 'AM',
    status: 'completed',
    title: 'Test session',
    durationMin: 60,
    rpe: 6,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as Session
}

describe('getRunningWeeklyLoads', () => {
  it('returns 4 weeks with zero load for empty sessions', () => {
    const loads = getRunningWeeklyLoads([])
    expect(loads).toHaveLength(4)
    expect(loads.every((week) => week.totalLoad === 0 && week.sessionsCount === 0)).toBe(true)
  })

  it('only counts completed running sessions', () => {
    const loads = getRunningWeeklyLoads([
      makeSession({ type: 'running', status: 'planned', date: dateInWeek(0) }),
      makeSession({ type: 'running', status: 'skipped', date: dateInWeek(0) }),
      makeSession({ type: 'strength', date: dateInWeek(0) }),
      makeSession({ type: 'running', date: dateInWeek(0), actualDurationMin: 50, actualRpe: 7 }),
    ])

    expect(loads[0].sessionsCount).toBe(1)
    expect(loads[0].totalLoad).toBe(350)
    expect(loads[0].totalDurationMin).toBe(50)
  })

  it('accumulates explicit distance found in session text', () => {
    const loads = getRunningWeeklyLoads([
      makeSession({
        type: 'running',
        date: dateInWeek(0),
        title: 'Tempo 12 km',
        actualDurationMin: 60,
        actualRpe: 7,
      }),
    ])

    expect(loads[0].totalDistanceKm).toBe(12)
  })

  it('estimates distance from pace range when explicit distance is missing', () => {
    const loads = getRunningWeeklyLoads([
      makeSession({
        type: 'running',
        date: dateInWeek(0),
        durationMin: 62,
        actualDurationMin: 62,
        actualRpe: 6,
        runningDetails: {
          runningType: 'tempo',
          targetPaceMin: '5:00',
          targetPaceMax: '5:20',
        },
      }),
    ])

    expect(loads[0].totalDistanceKm).toBe(12)
  })

  it('distributes load across the correct weeks', () => {
    const loads = getRunningWeeklyLoads([
      makeSession({ type: 'running', date: dateInWeek(0), actualDurationMin: 45, actualRpe: 6 }),
      makeSession({ type: 'running', date: dateInWeek(1), actualDurationMin: 90, actualRpe: 7 }),
    ])

    expect(loads[0].weekStart).toBe(weekStartISO(0))
    expect(loads[0].totalLoad).toBe(270)
    expect(loads[1].weekStart).toBe(weekStartISO(1))
    expect(loads[1].totalLoad).toBe(630)
  })
})

describe('getSquashWeeklyLoads', () => {
  it('returns 4 weeks with zero load for empty sessions', () => {
    const loads = getSquashWeeklyLoads([])
    expect(loads.length).toBeGreaterThanOrEqual(4)
    expect(loads.every((w) => w.totalLoad === 0)).toBe(true)
  })

  it('accumulates load correctly: duration × RPE', () => {
    const session = makeSession({
      type: 'squash',
      date: dateInWeek(0),
      actualDurationMin: 60,
      actualRpe: 7,
    })
    const loads = getSquashWeeklyLoads([session])
    expect(loads[0].totalLoad).toBe(420)
    expect(loads[0].sessionsCount).toBe(1)
  })

  it('counts match sessions separately in matchCount', () => {
    const training = makeSession({ type: 'squash', date: dateInWeek(0) })
    const match1 = makeSession({ type: 'squash', date: dateInWeek(0), subtype: 'match' })
    const match2 = makeSession({ type: 'squash', date: dateInWeek(0), subtype: 'competitive' })
    const loads = getSquashWeeklyLoads([training, match1, match2])
    expect(loads[0].sessionsCount).toBe(3)
    expect(loads[0].matchCount).toBe(2)
  })

  it('skips non-completed sessions', () => {
    const planned = makeSession({ type: 'squash', date: dateInWeek(0), status: 'planned' })
    const skipped = makeSession({ type: 'squash', date: dateInWeek(0), status: 'skipped' })
    const loads = getSquashWeeklyLoads([planned, skipped])
    expect(loads[0].totalLoad).toBe(0)
    expect(loads[0].sessionsCount).toBe(0)
  })
})

describe('getStrengthWeeklyLoads', () => {
  it('returns 4 weeks with zero load for empty sessions', () => {
    const loads = getStrengthWeeklyLoads([])
    expect(loads.length).toBeGreaterThanOrEqual(4)
    expect(loads.every((w) => w.totalLoad === 0)).toBe(true)
  })

  it('calculates load as duration × RPE', () => {
    const session = makeSession({
      type: 'strength',
      date: dateInWeek(0),
      actualDurationMin: 60,
      actualRpe: 7,
    })
    const loads = getStrengthWeeklyLoads([session])
    expect(loads[0].totalLoad).toBe(420)
  })

  it('falls back to planned duration and default RPE 6 when no actuals', () => {
    const session = makeSession({
      type: 'strength',
      date: dateInWeek(0),
      durationMin: 50,
    })
    delete (session as Partial<Session>).rpe
    const loads = getStrengthWeeklyLoads([session])
    expect(loads[0].totalLoad).toBe(300)
  })
})

describe('calculateRunningAcwr', () => {
  it('returns limited when no baseline exists', () => {
    const acwr = calculateRunningAcwr([
      makeSession({ type: 'running', date: dateInWeek(0), actualDurationMin: 60, actualRpe: 7 }),
    ])

    expect(acwr.status).toBe('limited')
    expect(acwr.ratio).toBeNull()
    expect(acwr.baselineWeeks).toBe(0)
  })

  it('returns risk when the acute load is much higher than chronic load', () => {
    const baseline = [1, 2, 3].map((weeksAgo) =>
      makeSession({ type: 'running', date: dateInWeek(weeksAgo), actualDurationMin: 45, actualRpe: 6 }),
    )
    const current = makeSession({
      type: 'running',
      date: dateInWeek(0),
      actualDurationMin: 120,
      actualRpe: 8,
    })

    const acwr = calculateRunningAcwr([current, ...baseline])
    expect(acwr.status).toBe('risk')
    expect(acwr.ratio).toBeGreaterThan(1.3)
  })

  it('returns undertrained when current week is well below chronic load', () => {
    const baseline = [1, 2, 3].map((weeksAgo) =>
      makeSession({ type: 'running', date: dateInWeek(weeksAgo), actualDurationMin: 80, actualRpe: 7 }),
    )
    const current = makeSession({
      type: 'running',
      date: dateInWeek(0),
      actualDurationMin: 20,
      actualRpe: 4,
    })

    const acwr = calculateRunningAcwr([current, ...baseline])
    expect(acwr.status).toBe('undertrained')
    expect(acwr.ratio).toBeLessThan(0.8)
  })
})

describe('calculateSquashAcwr', () => {
  it('returns limited with ratio null when no sessions', () => {
    const acwr = calculateSquashAcwr([])
    expect(acwr.ratio).toBeNull()
    expect(acwr.status).toBe('limited')
    expect(acwr.acuteLoad).toBe(0)
  })

  it('returns limited when fewer than 3 baseline weeks', () => {
    const sessions = [
      makeSession({ type: 'squash', date: dateInWeek(0), actualDurationMin: 60, actualRpe: 7 }),
      makeSession({ type: 'squash', date: dateInWeek(1), actualDurationMin: 60, actualRpe: 7 }),
      makeSession({ type: 'squash', date: dateInWeek(2), actualDurationMin: 60, actualRpe: 7 }),
    ]
    const acwr = calculateSquashAcwr(sessions)
    expect(acwr.status).toBe('limited')
  })

  it('returns optimal for balanced load across 4+ weeks', () => {
    const sessions = [0, 1, 2, 3].map((weeksAgo) =>
      makeSession({ type: 'squash', date: dateInWeek(weeksAgo), actualDurationMin: 60, actualRpe: 7 }),
    )
    const acwr = calculateSquashAcwr(sessions)
    expect(acwr.status).toBe('optimal')
    expect(acwr.ratio).toBeCloseTo(1, 1)
  })
})

describe('calculateStrengthAcwr', () => {
  it('returns limited with ratio null when no sessions', () => {
    const acwr = calculateStrengthAcwr([])
    expect(acwr.ratio).toBeNull()
    expect(acwr.status).toBe('limited')
  })

  it('returns risk when current load is >1.3× chronic', () => {
    const baseline = [1, 2, 3].map((weeksAgo) =>
      makeSession({ type: 'strength', date: dateInWeek(weeksAgo), actualDurationMin: 50, actualRpe: 6 }),
    )
    const currentWeek = makeSession({
      type: 'strength',
      date: dateInWeek(0),
      actualDurationMin: 90,
      actualRpe: 9,
    })
    const acwr = calculateStrengthAcwr([currentWeek, ...baseline])
    expect(acwr.status).toBe('risk')
  })
})

describe('computeAcwrByDiscipline', () => {
  it('keeps discipline statuses independent from each other', () => {
    const weeks: WeekLoadSummary[] = [
      {
        weekStart: weekStartISO(0),
        disciplines: [
          { type: 'running', plannedSessions: 1, completedSessions: 1, plannedMinutes: 80, completedMinutes: 80, weightedLoad: 800 },
          { type: 'squash', plannedSessions: 2, completedSessions: 2, plannedMinutes: 120, completedMinutes: 120, weightedLoad: 420 },
          { type: 'strength', plannedSessions: 1, completedSessions: 1, plannedMinutes: 60, completedMinutes: 60, weightedLoad: 300 },
        ],
        totalCompletedMinutes: 260,
        totalPlannedMinutes: 260,
        totalWeightedLoad: 1520,
        adherencePct: 100,
        avgActualRpe: 7,
        runningMinutes: 80,
        cyclingMinutes: 0,
      },
      {
        weekStart: weekStartISO(1),
        disciplines: [
          { type: 'running', plannedSessions: 1, completedSessions: 1, plannedMinutes: 40, completedMinutes: 40, weightedLoad: 240 },
          { type: 'squash', plannedSessions: 2, completedSessions: 2, plannedMinutes: 120, completedMinutes: 120, weightedLoad: 420 },
          { type: 'strength', plannedSessions: 1, completedSessions: 1, plannedMinutes: 60, completedMinutes: 60, weightedLoad: 300 },
        ],
        totalCompletedMinutes: 220,
        totalPlannedMinutes: 220,
        totalWeightedLoad: 960,
        adherencePct: 100,
        avgActualRpe: 6,
        runningMinutes: 40,
        cyclingMinutes: 0,
      },
      {
        weekStart: weekStartISO(2),
        disciplines: [
          { type: 'running', plannedSessions: 1, completedSessions: 1, plannedMinutes: 40, completedMinutes: 40, weightedLoad: 240 },
          { type: 'squash', plannedSessions: 2, completedSessions: 2, plannedMinutes: 120, completedMinutes: 120, weightedLoad: 420 },
          { type: 'strength', plannedSessions: 1, completedSessions: 1, plannedMinutes: 60, completedMinutes: 60, weightedLoad: 300 },
        ],
        totalCompletedMinutes: 220,
        totalPlannedMinutes: 220,
        totalWeightedLoad: 960,
        adherencePct: 100,
        avgActualRpe: 6,
        runningMinutes: 40,
        cyclingMinutes: 0,
      },
      {
        weekStart: weekStartISO(3),
        disciplines: [
          { type: 'running', plannedSessions: 1, completedSessions: 1, plannedMinutes: 40, completedMinutes: 40, weightedLoad: 240 },
          { type: 'squash', plannedSessions: 2, completedSessions: 2, plannedMinutes: 120, completedMinutes: 120, weightedLoad: 420 },
          { type: 'strength', plannedSessions: 1, completedSessions: 1, plannedMinutes: 60, completedMinutes: 60, weightedLoad: 300 },
        ],
        totalCompletedMinutes: 220,
        totalPlannedMinutes: 220,
        totalWeightedLoad: 960,
        adherencePct: 100,
        avgActualRpe: 6,
        runningMinutes: 40,
        cyclingMinutes: 0,
      },
    ]

    const acwrByDiscipline = computeAcwrByDiscipline(weeks)
    expect(acwrByDiscipline.running.status).toBe('risk')
    expect(acwrByDiscipline.squash.status).toBe('optimal')
    expect(acwrByDiscipline.strength.status).toBe('optimal')
  })
})

describe('weekStartISO helper', () => {
  it('current week start is a Monday', () => {
    const ws = weekStartISO(0)
    const day = new Date(`${ws}T00:00:00`).getDay()
    expect(day).toBe(1)
  })
})
