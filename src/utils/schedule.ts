import type { DayOfWeek } from '../types'

export const ONBOARDING_DAY_ORDER = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const
export type OnboardingDayKey = typeof ONBOARDING_DAY_ORDER[number]

export const DAY_OF_WEEK_ORDER: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

export const ONBOARDING_TO_DAY_OF_WEEK: Record<OnboardingDayKey, DayOfWeek> = {
  lun: 'monday',
  mar: 'tuesday',
  mié: 'wednesday',
  jue: 'thursday',
  vie: 'friday',
  sáb: 'saturday',
  dom: 'sunday',
}

export const DAY_OF_WEEK_TO_ONBOARDING: Record<DayOfWeek, OnboardingDayKey> = {
  monday: 'lun',
  tuesday: 'mar',
  wednesday: 'mié',
  thursday: 'jue',
  friday: 'vie',
  saturday: 'sáb',
  sunday: 'dom',
}

export function orderSelectedValues<T extends string>(values: readonly T[], order: readonly T[]): T[] {
  const unique = new Set(values)
  return order.filter((value): value is T => unique.has(value))
}

export function toggleOrderedValue<T extends string>(
  values: readonly T[],
  value: T,
  order: readonly T[],
): T[] {
  return values.includes(value)
    ? orderSelectedValues(values.filter((item) => item !== value), order)
    : orderSelectedValues([...values, value], order)
}

export function replaceOrderedValues<T extends string>(values: readonly T[], nextValues: readonly T[], order: readonly T[]): T[] {
  const nextSet = new Set(nextValues)
  const alreadySelected = values.every((value) => nextSet.has(value)) && values.length === nextSet.size
  return alreadySelected ? [] : orderSelectedValues(nextValues, order)
}

export function mapOnboardingDaysToTrainingDays(days: readonly string[] | undefined): DayOfWeek[] {
  if (!days?.length) return []

  return orderSelectedValues(
    days
      .map((day) => ONBOARDING_TO_DAY_OF_WEEK[day as OnboardingDayKey])
      .filter((day): day is DayOfWeek => day !== undefined),
    DAY_OF_WEEK_ORDER,
  )
}

export function clampSessionsPerWeekToAvailability(
  sessionsPerWeek: number | undefined,
  trainingDays: readonly DayOfWeek[],
  allowDoubleSession: boolean,
): number | undefined {
  if (sessionsPerWeek == null) return undefined

  const maxSessions = trainingDays.length * (allowDoubleSession ? 2 : 1)
  if (maxSessions <= 0) return undefined

  return Math.min(sessionsPerWeek, maxSessions)
}
