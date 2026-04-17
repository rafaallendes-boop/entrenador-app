export const ROUTES = {
  HOME:             '/',
  WEEK:             '/week',
  DAY:              (date: string) => `/day/${date}`,
  CHAT:             '/chat',
  PLAN_BUILDER:     '/plan-builder',
  COMPETITION_PLAN: '/competition-plan',
  PLAN_BUILDER_V2: '/plans/builder',
  HISTORY:          '/history',
  SETTINGS:         '/settings',
  IMPORT:           '/import',
  ONBOARDING:       '/onboarding',
} as const
