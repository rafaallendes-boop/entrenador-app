import { describe, expect, it } from 'vitest'
import {
  alignSessionsToScheduleConstraints,
  buildScheduleAwareConfig,
  resolveDayScheduleConstraint,
  resolveScheduleCapacity,
} from '../scheduleConstraints'
import { applyWeekCreatorDateWindowToConfig, resolveWeekCreatorDateWindow } from '../WeekCreatorDateWindow'
import type { WeekCreatorEffectiveConfig } from '../WeekCreatorConfig'

function makeConfig(overrides: Partial<WeekCreatorEffectiveConfig> = {}): WeekCreatorEffectiveConfig {
  return {
    allowedSports: ['squash'],
    primarySport: 'squash',
    sessionsPerWeek: 4,
    maxSessionsPerWeek: 6,
    sessionDurationMins: 60,
    trainingDays: ['monday', 'wednesday', 'thursday', 'friday'],
    allowDoubleSession: false,
    currentFitnessLevel: 'normal',
    currentFatigue: 'normal',
    fromWizard: false,
    configSource: 'schedule',
    ...overrides,
  }
}

describe('resolveScheduleCapacity', () => {
  it('drops unavailable days from the usable block count', () => {
    const capacity = resolveScheduleCapacity({
      trainingDays: ['monday', 'tuesday', 'wednesday'],
      allowDoubleSession: false,
      scheduleConstraints: 'martes no disponible',
    })

    expect(capacity.trainingDays).toEqual(['monday', 'wednesday'])
    expect(capacity.capacity).toBe(2)
  })

  it('refuses doubles on a day pinned to a single block', () => {
    const capacity = resolveScheduleCapacity({
      trainingDays: ['monday', 'tuesday'],
      doubleSessionDays: ['monday', 'tuesday'],
      allowDoubleSession: true,
      scheduleConstraints: 'martes solo PM',
    })

    expect(capacity.doubleSessionDays).toEqual(['monday'])
    expect(capacity.capacity).toBe(3)
  })

  it('materializes an implicit "any day" double list before filtering it', () => {
    const capacity = resolveScheduleCapacity({
      trainingDays: ['monday', 'tuesday'],
      doubleSessionDays: [],
      allowDoubleSession: true,
      scheduleConstraints: 'martes solo AM',
    })

    // Without materializing, the empty list would be read as "every day" and
    // hand Tuesday a second block it cannot host.
    expect(capacity.doubleSessionDays).toEqual(['monday'])
    expect(capacity.capacity).toBe(3)
  })

  it('reports no capacity when every training day is unavailable', () => {
    const capacity = resolveScheduleCapacity({
      trainingDays: ['saturday'],
      allowDoubleSession: true,
      scheduleConstraints: 'no disponible sabados',
    })

    expect(capacity.capacity).toBe(0)
  })
})

describe('applyWeekCreatorDateWindowToConfig', () => {
  it('discounts constrained days when sizing a partial week', () => {
    const window = resolveWeekCreatorDateWindow('2026-05-11', '2026-05-13')
    const config = applyWeekCreatorDateWindowToConfig(
      makeConfig({ scheduleConstraints: 'jueves no disponible' }),
      window,
    )

    // Wednesday/Thursday/Friday survive the date window, but Thursday is closed,
    // so only two blocks remain and the week must shrink to match.
    expect(config.trainingDays).toEqual(['wednesday', 'thursday', 'friday'])
    expect(config.sessionsPerWeek).toBe(2)
    expect(config.maxSessionsPerWeek).toBe(2)
  })

  it('keeps the requested session count when constraints leave room', () => {
    const window = resolveWeekCreatorDateWindow('2026-05-11', '2026-05-13')
    const config = applyWeekCreatorDateWindowToConfig(
      makeConfig({ sessionsPerWeek: 3, scheduleConstraints: 'jueves solo PM' }),
      window,
    )

    expect(config.sessionsPerWeek).toBe(3)
  })
})

describe('resolveDayScheduleConstraint', () => {
  it('reads a colon-separated day constraint', () => {
    expect(resolveDayScheduleConstraint('martes: solo PM', 'tuesday')).toBe('PM')
  })

  it('does not bleed a constraint across a comma-separated day list', () => {
    const constraints = 'lunes no disponible, martes solo AM'

    expect(resolveDayScheduleConstraint(constraints, 'monday')).toBe('unavailable')
    expect(resolveDayScheduleConstraint(constraints, 'tuesday')).toBe('AM')
  })
})

describe('shared schedule helpers', () => {
  const sessions = [
    { date: '2026-07-20', timeBlock: 'AM' as const, sessionType: 'squash' as const, title: 'A', durationMin: 60, objective: 'a' },
    { date: '2026-07-21', timeBlock: 'AM' as const, sessionType: 'strength' as const, title: 'B', durationMin: 60, objective: 'b' },
  ]

  it('moves a session onto the block its day is pinned to', () => {
    const result = alignSessionsToScheduleConstraints(sessions, 'martes solo PM')
    expect(result.adjustedCount).toBe(1)
    expect(result.sessions[1].timeBlock).toBe('PM')
    expect(result.sessions[0].timeBlock).toBe('AM')
  })

  it('does not manufacture a collision when skipOccupied is set', () => {
    const crowded = [
      ...sessions,
      { date: '2026-07-21', timeBlock: 'PM' as const, sessionType: 'cycling' as const, title: 'C', durationMin: 60, objective: 'c' },
    ]
    const result = alignSessionsToScheduleConstraints(crowded, 'martes solo PM', { skipOccupied: true })
    expect(result.adjustedCount).toBe(0)
    expect(result.sessions[1].timeBlock).toBe('AM')
  })

  it('strips closed days and pinned-day doubles from the config handed to repair', () => {
    const aware = buildScheduleAwareConfig({
      trainingDays: ['monday', 'tuesday', 'wednesday'],
      doubleSessionDays: ['monday', 'tuesday'],
      allowDoubleSession: true,
      scheduleConstraints: 'miercoles no disponible, martes solo PM',
    })
    expect(aware.trainingDays).toEqual(['monday', 'tuesday'])
    expect(aware.doubleSessionDays).toEqual(['monday'])
    expect(aware.allowDoubleSession).toBe(true)
  })
})
