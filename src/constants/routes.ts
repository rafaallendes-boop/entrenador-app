export const ROUTES = {
  HOME:    '/',
  WEEK:    '/week',
  DAY:     (date: string) => `/day/${date}`,
  CHAT:    '/chat',
  HISTORY: '/history',
  IMPORT:  '/import',
} as const
