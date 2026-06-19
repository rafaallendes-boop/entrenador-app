import { describe, expect, it } from 'vitest'

import type { AthleteProfile } from '../../types'
import {
  computeMacroPlan,
  computeWeeksRemaining,
  formatWeeksRemaining,
  getPhaseLabel,
  getPrimaryGoalEvent,
  resolvePhase,
} from '../macroPlan'

function makeProfile(date = '2026-06-01'): AthleteProfile {
  return {
    id: 'default',
    updatedAt: Date.now(),
    goalEvents: [
      {
        id: 'goal-1',
        title: '2do nacional',
        date,
        sport: 'squash',
        priority: 'primary',
      },
    ],
  }
}

describe('macroPlan', () => {
  it('returns undefined when no valid primary goal exists', () => {
    expect(computeMacroPlan(null)).toBeUndefined()
    expect(
      computeMacroPlan({
        id: 'default',
        updatedAt: Date.now(),
        goalEvents: [{ id: 'x', title: '', date: 'bad-date', sport: 'squash', priority: 'primary' }],
      }),
    ).toBeUndefined()
  })

  it('selects the first valid primary goal event', () => {
    const profile: AthleteProfile = {
      id: 'default',
      updatedAt: Date.now(),
      goalEvents: [
        { id: 'bad', title: '', date: '2026-06-01', sport: 'squash', priority: 'primary' },
        { id: 'good', title: 'Target', date: '2026-06-15', sport: 'running', priority: 'primary' },
      ],
    }

    expect(getPrimaryGoalEvent(profile)?.id).toBe('good')
  })

  it('rejects impossible ISO dates for goal events', () => {
    const profile: AthleteProfile = {
      id: 'default',
      updatedAt: Date.now(),
      goalEvents: [
        { id: 'bad', title: 'Fecha imposible', date: '2026-02-31', sport: 'squash', priority: 'primary' },
      ],
    }

    expect(getPrimaryGoalEvent(profile)).toBeUndefined()
    expect(computeMacroPlan(profile)).toBeUndefined()
  })

  it('computes weeks remaining by rounding partial weeks up', () => {
    const weeks = computeWeeksRemaining('2026-04-21', new Date('2026-04-08T10:00:00'))
    expect(weeks).toBe(2)
  })

  it('resolves phases at threshold boundaries', () => {
    expect(resolvePhase(13)).toBe('base')
    expect(resolvePhase(12)).toBe('build')
    expect(resolvePhase(8)).toBe('peak')
    expect(resolvePhase(4)).toBe('taper')
    expect(resolvePhase(0)).toBe('race')
    expect(resolvePhase(-1)).toBe('transition')
  })

  it('uses a shorter taper for squash tournament preparation', () => {
    expect(resolvePhase(6, 'squash')).toBe('build')
    // peak is now only 2 weeks (weeksRemaining 2-3)
    expect(resolvePhase(5, 'squash')).toBe('build')
    expect(resolvePhase(4, 'squash')).toBe('build')
    expect(resolvePhase(3, 'squash')).toBe('peak')
    expect(resolvePhase(2, 'squash')).toBe('peak')
    expect(resolvePhase(1, 'squash')).toBe('taper')
    expect(resolvePhase(0, 'squash')).toBe('race')
  })

  it('computes a deterministic macro plan from the primary event', () => {
    // weeksRemaining=4 → build under new squash peak window (peak is only 2-3 weeks out)
    const plan = computeMacroPlan(makeProfile('2026-05-05'), new Date('2026-04-07T09:00:00'))
    expect(plan).toMatchObject({
      goalEventId: 'goal-1',
      goalEventDate: '2026-05-05',
      weeksRemaining: 4,
      currentPhase: 'build',
    })
    expect(plan?.headline.length).toBeGreaterThan(0)
    expect(plan?.timeline.length).toBeGreaterThan(0)
    expect(plan?.sportDetails[0]).toMatchObject({
      sport: 'squash',
      role: 'primary',
    })
  })

  it('adds sport detail and visible secondary events without changing the primary phase', () => {
    // weeksRemaining=8 (2026-06-02 from 2026-04-07) → build under new squash thresholds (build: 4-9)
    const profile: AthleteProfile = {
      ...makeProfile('2026-06-02'),
      sportContext: {
        enabledSports: ['squash', 'running', 'strength'],
        primarySport: 'squash',
        secondarySports: ['running', 'strength'],
        trainingPriority: 'performance',
      },
      planWizardConfig: {
        goalEventId: 'goal-1',
        trainingDays: ['monday', 'wednesday', 'friday'],
        sessionsPerWeek: 4,
        sessionDurationMins: 60,
        allowDoubleSession: false,
        complementarySports: ['running', 'strength'],
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        createdAt: '2026-04-01',
        updatedAt: '2026-04-01',
      },
      goalEvents: [
        ...makeProfile('2026-06-02').goalEvents!,
        {
          id: 'secondary-1',
          title: '10K tune-up',
          date: '2026-05-10',
          sport: 'running',
          priority: 'secondary',
        },
      ],
    }

    const plan = computeMacroPlan(profile, new Date('2026-04-07T09:00:00'))
    expect(plan?.currentPhase).toBe('build')
    expect(plan?.sportDetails.map((detail) => detail.sport)).toEqual(['squash', 'running', 'strength'])
    expect(plan?.secondaryEvents).toHaveLength(1)
    expect(plan?.timeline.some((entry) => entry.eventMarkers.some((marker) => marker.id === 'secondary-1'))).toBe(true)
  })

  it('formats display helpers correctly', () => {
    expect(getPhaseLabel('build')).toBe('Construcción')
    expect(formatWeeksRemaining(-1)).toBe('Evento pasado')
    expect(formatWeeksRemaining(0)).toBe('Semana Competencia')
    expect(formatWeeksRemaining(1)).toBe('1 semana')
    expect(formatWeeksRemaining(3)).toBe('3 semanas')
  })
})

describe('resolvePhase squash periodization', () => {
  it('keeps peak to at most 2 weeks for squash', () => {
    const phasesByRemaining = [0, 1, 2, 3, 4, 5].map((r) => resolvePhase(r, 'squash'))
    // remaining: 0=race, 1=taper, 2-3=peak, 4-5=build
    expect(phasesByRemaining).toEqual(['race', 'taper', 'peak', 'peak', 'build', 'build'])
    const peakCount = phasesByRemaining.filter((p) => p === 'peak').length
    expect(peakCount).toBeLessThanOrEqual(2)
  })

  it('produces a timeline with non-decreasing startWeek', () => {
    // 6-week squash plan: event on 2026-07-31, ref 2026-06-19 → weeksRemaining=6
    const profile = makeProfile('2026-07-31')
    const plan = computeMacroPlan(profile, new Date('2026-06-19T00:00:00'))
    expect(plan).toBeDefined()
    const startWeeks = plan!.timeline.map((t) => t.startWeek)
    // startWeek should be 0-based offset from plan start: ascending across the timeline
    for (let i = 1; i < startWeeks.length; i++) {
      expect(startWeeks[i]).toBeGreaterThanOrEqual(startWeeks[i - 1])
    }
  })
})
