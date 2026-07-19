import { describe, expect, it } from 'vitest'

import {
  DAY_OF_WEEK_ORDER,
  ONBOARDING_DAY_ORDER,
  MAX_WEEKLY_SESSIONS,
  clampSessionsPerWeekToAvailability,
  getSessionCapacityFromAvailability,
  mapOnboardingDaysToTrainingDays,
  orderSelectedValues,
  replaceOrderedValues,
  toggleOrderedValue,
} from '../schedule'

describe('schedule utils', () => {
  it('keeps selected onboarding days ordered and unique', () => {
    expect(orderSelectedValues(['sáb', 'lun', 'vie', 'lun'], ONBOARDING_DAY_ORDER)).toEqual(['lun', 'vie', 'sáb'])
  })

  it('toggles training days without losing previous selections', () => {
    const withFriday = toggleOrderedValue(['monday', 'wednesday'], 'friday', DAY_OF_WEEK_ORDER)
    expect(withFriday).toEqual(['monday', 'wednesday', 'friday'])

    const withSaturday = toggleOrderedValue(withFriday, 'saturday', DAY_OF_WEEK_ORDER)
    expect(withSaturday).toEqual(['monday', 'wednesday', 'friday', 'saturday'])
  })

  it('replaces selections with presets and clears when reapplying the same preset', () => {
    expect(replaceOrderedValues(['monday'], ['monday', 'tuesday', 'wednesday'], DAY_OF_WEEK_ORDER)).toEqual(['monday', 'tuesday', 'wednesday'])
    expect(replaceOrderedValues(['monday', 'tuesday'], ['monday', 'tuesday'], DAY_OF_WEEK_ORDER)).toEqual([])
  })

  it('maps onboarding availability to plan-training days in calendar order', () => {
    expect(mapOnboardingDaysToTrainingDays(['sáb', 'lun', 'vie'])).toEqual(['monday', 'friday', 'saturday'])
    expect(mapOnboardingDaysToTrainingDays(['sab', 'mie', 'lun'])).toEqual(['monday', 'wednesday', 'saturday'])
  })

  it('clamps sessions per week to the current day availability', () => {
    expect(clampSessionsPerWeekToAvailability(5, ['monday', 'wednesday', 'friday'], false)).toBe(3)
    expect(clampSessionsPerWeekToAvailability(5, ['monday', 'wednesday', 'friday'], true)).toBe(5)
    expect(clampSessionsPerWeekToAvailability(6, ['monday', 'wednesday', 'friday'], true, ['monday'])).toBe(4)
    expect(clampSessionsPerWeekToAvailability(3, [], false)).toBeUndefined()
  })

  it('supports up to eight sessions only when double-session capacity exists', () => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
    expect(MAX_WEEKLY_SESSIONS).toBe(8)
    expect(getSessionCapacityFromAvailability(days, false)).toBe(6)
    expect(getSessionCapacityFromAvailability(days, true, ['monday'])).toBe(7)
    expect(getSessionCapacityFromAvailability(days, true, ['monday', 'wednesday', 'friday'])).toBe(8)
    expect(clampSessionsPerWeekToAvailability(8, days, true, ['monday', 'wednesday', 'friday'])).toBe(8)
  })

  it('honours schedule constraints so the UI cannot advertise blocks the engine will clamp', () => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
    const doubles = ['monday', 'tuesday'] as const

    expect(getSessionCapacityFromAvailability(days, true, doubles)).toBe(8)
    // Monday drops out entirely, and with it its double.
    expect(getSessionCapacityFromAvailability(days, true, doubles, 'lunes no disponible')).toBe(6)
    // A day pinned to one block still hosts a session but never a double.
    expect(getSessionCapacityFromAvailability(days, true, doubles, 'martes solo PM')).toBe(7)
    expect(clampSessionsPerWeekToAvailability(8, days, true, doubles, 'lunes no disponible')).toBe(6)
  })
})
