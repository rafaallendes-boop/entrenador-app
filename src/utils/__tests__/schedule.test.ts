import { describe, expect, it } from 'vitest'

import {
  DAY_OF_WEEK_ORDER,
  ONBOARDING_DAY_ORDER,
  clampSessionsPerWeekToAvailability,
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
})
