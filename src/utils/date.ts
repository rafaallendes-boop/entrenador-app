import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  isToday,
  parseISO,
  isSameDay,
  addDays,
} from 'date-fns'
import { es } from 'date-fns/locale'

export const toISO = (date: Date): string => format(date, 'yyyy-MM-dd')

export const fromISO = (iso: string): Date => parseISO(iso)

export const getWeekStart = (date: Date): Date =>
  startOfWeek(date, { weekStartsOn: 1 }) // Monday

export const getWeekEnd = (date: Date): Date =>
  endOfWeek(date, { weekStartsOn: 1 })

export const getWeekDays = (weekStart: Date): Date[] =>
  eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) })

export const nextWeek = (date: Date): Date => addWeeks(date, 1)
export const prevWeek = (date: Date): Date => subWeeks(date, 1)

export const formatDay = (date: Date): string =>
  format(date, 'EEE', { locale: es })

export const formatDayNum = (date: Date): string => format(date, 'd')

export const formatFullDate = (date: Date): string =>
  format(date, "EEEE d 'de' MMMM", { locale: es })

export const formatShortDate = (date: Date): string =>
  format(date, "d MMM", { locale: es })

export const formatWeekRange = (weekStart: Date): string => {
  const end = addDays(weekStart, 6)
  return `${format(weekStart, 'd MMM', { locale: es })} – ${format(end, 'd MMM yyyy', { locale: es })}`
}

export const isDateToday = (iso: string): boolean =>
  isToday(parseISO(iso))

export const isSameDayISO = (isoA: string, isoB: string): boolean =>
  isSameDay(parseISO(isoA), parseISO(isoB))

export const currentWeekStartISO = (): string =>
  toISO(getWeekStart(new Date()))

export const todayISO = (): string => toISO(new Date())
