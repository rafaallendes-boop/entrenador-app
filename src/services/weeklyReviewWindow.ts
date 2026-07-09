import { todayISO } from '../utils/date'

const WEEKLY_REVIEW_WEEKDAYS = new Set([0, 5, 6])

export function isWeeklyReviewWindowOpen(dateISO = todayISO()): boolean {
  const weekday = new Date(`${dateISO}T12:00:00`).getDay()
  return WEEKLY_REVIEW_WEEKDAYS.has(weekday)
}
