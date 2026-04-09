import type { AthleteProfile, DayLog, MacroWeekCoherenceSummary, Session, WeekSummary } from '../types'
import type { LoadAnalytics } from './loadAnalytics'
import { buildWeeklyActionSummary } from './weeklyActionLoop'

const NOTIFY_TIME: Record<string, { h: number; m: number }> = {
  AM: { h: 7, m: 30 },
  PM: { h: 17, m: 30 },
}

const ACTIVATION_NOTIFY_TIME = {
  weekPlanning: { h: 9, m: 15 },
  coachNote: { h: 12, m: 15 },
  coherence: { h: 13, m: 0 },
  checkIn: { h: 20, m: 30 },
}

const SENT_NOTIFICATIONS_KEY = 'scheduled_session_notifications_v1'
const NOTIFICATION_PREFERENCES_KEY = 'entrenador_notification_preferences_v1'
const SYNC_INTERVAL_MS = 60_000
const LATE_DELIVERY_GRACE_MS = 90 * 60 * 1000

export type NotificationCategory =
  | 'session_reminders'
  | 'daily_checkin'
  | 'weekly_planning'
  | 'coach_followup'
  | 'load_alerts'

export interface NotificationPreferences {
  sessionReminders: boolean
  dailyCheckIn: boolean
  weeklyPlanning: boolean
  coachFollowUp: boolean
  loadAlerts: boolean
}

interface ScheduledAppNotification {
  id: string
  title: string
  body: string
  notifyAt: number
  tag: string
  category: NotificationCategory
  data?: Record<string, unknown>
}

interface SentNotificationsState {
  date: string
  tags: string[]
}

interface NotificationWorkerState {
  date: string
  notifications: Array<{ tag: string; notifyAt: number; title: string; body: string; category: NotificationCategory; data?: Record<string, unknown> }>
  sentTags: string[]
  recoveredTags: string[]
  graceMs: number
  lastSyncedAt?: number
  lastClearReason?: string | null
}

export interface NotificationDebugState {
  date: string
  scheduledCount: number
  pendingCount: number
  sentCount: number
  recoveredCount: number
  categories: Partial<Record<NotificationCategory, number>>
  enabledCategories: NotificationPreferences
  graceMinutes: number
  permission: NotificationPermission | 'unsupported'
  lastSyncedAt: number | null
  lastClearReason: string | null
}

export interface NotificationSyncContext {
  sessions: Session[]
  currentWeekSummary?: WeekSummary | null
  macroWeekCoherence?: MacroWeekCoherenceSummary | null
  todayDayLog?: DayLog
  athleteProfile?: AthleteProfile | null
  loadAnalytics?: LoadAnalytics | null
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  sessionReminders: true,
  dailyCheckIn: true,
  weeklyPlanning: true,
  coachFollowUp: true,
  loadAlerts: true,
}

export function notificationsSupported(): boolean {
  return 'Notification' in window && 'serviceWorker' in navigator
}

export function getNotificationPermission(): NotificationPermission | null {
  if (!notificationsSupported()) return null
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied'
  return Notification.requestPermission()
}

export function getNotificationPreferences(): NotificationPreferences {
  const raw = localStorage.getItem(NOTIFICATION_PREFERENCES_KEY)
  if (!raw) return { ...DEFAULT_NOTIFICATION_PREFERENCES }

  try {
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>
    return {
      sessionReminders: parsed.sessionReminders ?? DEFAULT_NOTIFICATION_PREFERENCES.sessionReminders,
      dailyCheckIn: parsed.dailyCheckIn ?? DEFAULT_NOTIFICATION_PREFERENCES.dailyCheckIn,
      weeklyPlanning: parsed.weeklyPlanning ?? DEFAULT_NOTIFICATION_PREFERENCES.weeklyPlanning,
      coachFollowUp: parsed.coachFollowUp ?? DEFAULT_NOTIFICATION_PREFERENCES.coachFollowUp,
      loadAlerts: parsed.loadAlerts ?? DEFAULT_NOTIFICATION_PREFERENCES.loadAlerts,
    }
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  }
}

export function saveNotificationPreferences(patch: Partial<NotificationPreferences>): NotificationPreferences {
  const next = { ...getNotificationPreferences(), ...patch }
  localStorage.setItem(NOTIFICATION_PREFERENCES_KEY, JSON.stringify(next))
  return next
}

export function buildScheduledNotifications(
  input: NotificationSyncContext | Session[],
  today = todayISODate(),
  now = new Date(),
  preferences = getNotificationPreferences(),
): ScheduledAppNotification[] {
  const context = Array.isArray(input) ? { sessions: input } : input
  const items: ScheduledAppNotification[] = []
  const weeklyActionSummary =
    preferences.dailyCheckIn || preferences.weeklyPlanning || preferences.coachFollowUp || preferences.loadAlerts
      ? buildWeeklyActionSummary({
          sessions: context.sessions,
          currentWeekSummary: context.currentWeekSummary,
          todayDayLog: context.todayDayLog,
          macroWeekCoherence: context.macroWeekCoherence,
          loadAnalytics: context.loadAnalytics,
          today,
        })
      : null

  if (preferences.sessionReminders) {
    items.push(...buildSessionReminderNotifications(context.sessions, today, now))
  }
  if (preferences.dailyCheckIn) {
    const checkInNotification = buildDailyCheckInNotification(weeklyActionSummary, today, now)
    if (checkInNotification) items.push(checkInNotification)
  }
  if (preferences.weeklyPlanning) {
    const weekPlanningNotification = buildWeekPlanningNotification(weeklyActionSummary, today, now)
    if (weekPlanningNotification) items.push(weekPlanningNotification)
  }
  if (preferences.coachFollowUp) {
    const coachNotification = buildCoachFollowUpNotification(weeklyActionSummary, today, now)
    if (coachNotification) items.push(coachNotification)
  }
  if (preferences.loadAlerts) {
    const coherenceNotification = buildCoherenceAlertNotification(weeklyActionSummary, today, now)
    if (coherenceNotification) items.push(coherenceNotification)
  }

  return dedupeNotifications(items).sort((a, b) => a.notifyAt - b.notifyAt)
}

export async function scheduleTodayNotifications(input: NotificationSyncContext | Session[]): Promise<void> {
  if (!notificationsSupported()) return

  const today = todayISODate()
  if (Notification.permission !== 'granted') {
    await clearTodayNotifications(today, 'permission-not-granted')
    return
  }

  const registration = await navigator.serviceWorker.ready
  const preferences = getNotificationPreferences()
  const scheduled = buildScheduledNotifications(input, today, new Date(), preferences)
  if (scheduled.length === 0) {
    await clearTodayNotifications(today, 'no-matching-rules')
    return
  }

  const dueNow = scheduled.filter((item) => isDueWithinGraceWindow(item.notifyAt) && !hasNotificationBeenSent(item.tag, today))
  const upcoming = scheduled.filter((item) => item.notifyAt > Date.now() && !hasNotificationBeenSent(item.tag, today))

  for (const item of dueNow) {
    await showScheduledNotification(registration, item)
    markNotificationSent(item.tag, today)
  }

  await postMessageToNotificationWorker(registration, {
    type: 'SCHEDULE_NOTIFICATIONS',
    date: today,
    notifications: upcoming,
    graceMs: LATE_DELIVERY_GRACE_MS,
    lastSyncedAt: Date.now(),
  })
}

export function startNotificationSync(getContext: () => NotificationSyncContext | Session[]): () => void {
  if (!notificationsSupported()) return () => undefined

  const sync = () => {
    void scheduleTodayNotifications(getContext())
  }

  const onFocus = () => sync()
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') sync()
  }

  sync()
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
  const intervalId = window.setInterval(sync, SYNC_INTERVAL_MS)

  return () => {
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.clearInterval(intervalId)
  }
}

export async function getNotificationDebugState(): Promise<NotificationDebugState | null> {
  if (!notificationsSupported()) return null

  try {
    const cache = await caches.open('entrenador-notifications-v1')
    const response = await cache.match('/__notification_state__')
    if (!response) return null

    const parsed = await response.json() as Partial<NotificationWorkerState>
    const notifications = Array.isArray(parsed.notifications) ? parsed.notifications : []
    const sentTags = Array.isArray(parsed.sentTags) ? parsed.sentTags.filter((tag): tag is string => typeof tag === 'string') : []
    const recoveredTags = Array.isArray(parsed.recoveredTags) ? parsed.recoveredTags.filter((tag): tag is string => typeof tag === 'string') : []
    const pendingCount = notifications.filter((item) => typeof item?.tag === 'string' && !sentTags.includes(item.tag)).length
    const categories: Partial<Record<NotificationCategory, number>> = {}

    for (const item of notifications) {
      if (!item || typeof item.category !== 'string') continue
      const category = item.category as NotificationCategory
      categories[category] = (categories[category] ?? 0) + 1
    }

    return {
      date: typeof parsed.date === 'string' ? parsed.date : todayISODate(),
      scheduledCount: notifications.length,
      pendingCount,
      sentCount: sentTags.length,
      recoveredCount: recoveredTags.length,
      categories,
      enabledCategories: getNotificationPreferences(),
      graceMinutes: Math.round(((typeof parsed.graceMs === 'number' ? parsed.graceMs : LATE_DELIVERY_GRACE_MS) / 1000) / 60),
      permission: Notification.permission,
      lastSyncedAt: typeof parsed.lastSyncedAt === 'number' ? parsed.lastSyncedAt : null,
      lastClearReason: typeof parsed.lastClearReason === 'string' ? parsed.lastClearReason : null,
    }
  } catch {
    return null
  }
}

export async function refreshTodayNotifications(input: NotificationSyncContext | Session[]): Promise<void> {
  await scheduleTodayNotifications(input)
}

export async function clearTodayNotifications(date = todayISODate(), reason = 'manual-clear'): Promise<void> {
  if (!notificationsSupported()) return

  clearSentNotificationsState(date)

  try {
    const registration = await navigator.serviceWorker.ready
    await postMessageToNotificationWorker(registration, {
      type: 'CLEAR_NOTIFICATIONS',
      date,
      reason,
      lastSyncedAt: Date.now(),
    })
  } catch {
    return
  }
}

function buildSessionReminderNotifications(sessions: Session[], today: string, now: Date): ScheduledAppNotification[] {
  return sessions
    .filter((session) => session.date === today && session.status === 'planned')
    .map((session) => {
      const time = NOTIFY_TIME[session.timeBlock] ?? NOTIFY_TIME.AM
      const notifyAt = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        time.h,
        time.m,
        0,
      ).getTime()

      return {
        id: session.id,
        title: 'Sesion en 30 min',
        body: session.title,
        notifyAt,
        tag: buildNotificationTag('session_reminders', session.id, today),
        category: 'session_reminders',
        data: {
          sessionId: session.id,
          type: session.type,
          notifyAt,
          source: 'page-sync',
        },
      }
    })
}

function buildDailyCheckInNotification(
  summary: ReturnType<typeof buildWeeklyActionSummary> | null,
  today: string,
  now: Date,
): ScheduledAppNotification | null {
  if (!summary) return null
  const action = summary.primaryAction?.kind === 'close_checkin'
    ? summary.primaryAction
    : summary.secondaryActions.find((item) => item.kind === 'close_checkin')
  if (!action) return null

  return {
    id: `checkin-${today}`,
    title: action.title,
    body: action.body,
    notifyAt: atTime(now, ACTIVATION_NOTIFY_TIME.checkIn.h, ACTIVATION_NOTIFY_TIME.checkIn.m),
    tag: buildNotificationTag('daily_checkin', 'today', today),
    category: 'daily_checkin',
    data: {
      source: 'activation-checkin',
      date: today,
    },
  }
}

function buildWeekPlanningNotification(
  summary: ReturnType<typeof buildWeeklyActionSummary> | null,
  today: string,
  now: Date,
): ScheduledAppNotification | null {
  if (!summary) return null
  const action = summary.primaryAction?.kind === 'plan_week'
    ? summary.primaryAction
    : summary.secondaryActions.find((item) => item.kind === 'plan_week')
  if (!action) return null

  return {
    id: `week-empty-${today}`,
    title: action.title,
    body: action.body,
    notifyAt: atTime(now, ACTIVATION_NOTIFY_TIME.weekPlanning.h, ACTIVATION_NOTIFY_TIME.weekPlanning.m),
    tag: buildNotificationTag('weekly_planning', 'week-empty', today),
    category: 'weekly_planning',
    data: {
      source: 'activation-week-empty',
      date: today,
    },
  }
}

function buildCoachFollowUpNotification(
  summary: ReturnType<typeof buildWeeklyActionSummary> | null,
  today: string,
  now: Date,
): ScheduledAppNotification | null {
  if (!summary) return null
  const action = summary.primaryAction?.kind === 'review_coach_note'
    ? summary.primaryAction
    : summary.secondaryActions.find((item) => item.kind === 'review_coach_note')
  if (!action) return null

  return {
    id: `coach-note-${today}`,
    title: action.title,
    body: action.body,
    notifyAt: atTime(now, ACTIVATION_NOTIFY_TIME.coachNote.h, ACTIVATION_NOTIFY_TIME.coachNote.m),
    tag: buildNotificationTag('coach_followup', 'coach-note', today),
    category: 'coach_followup',
    data: {
      source: 'activation-coach-note',
      date: today,
    },
  }
}

function buildCoherenceAlertNotification(
  summary: ReturnType<typeof buildWeeklyActionSummary> | null,
  today: string,
  now: Date,
): ScheduledAppNotification | null {
  if (!summary) return null
  const action = summary.primaryAction?.kind === 'fix_coherence'
    ? summary.primaryAction
    : summary.secondaryActions.find((item) => item.kind === 'fix_coherence')
  if (!action) return null

  return {
    id: `coherence-${today}`,
    title: action.title,
    body: action.body,
    notifyAt: atTime(now, ACTIVATION_NOTIFY_TIME.coherence.h, ACTIVATION_NOTIFY_TIME.coherence.m),
    tag: buildNotificationTag('load_alerts', 'coherence-warning', today),
    category: 'load_alerts',
    data: {
      source: 'activation-coherence',
      date: today,
    },
  }
}

function dedupeNotifications(items: ScheduledAppNotification[]): ScheduledAppNotification[] {
  const byTag = new Map<string, ScheduledAppNotification>()
  for (const item of items) {
    if (!byTag.has(item.tag)) byTag.set(item.tag, item)
  }
  return [...byTag.values()]
}

async function showScheduledNotification(
  registration: ServiceWorkerRegistration,
  item: ScheduledAppNotification,
): Promise<void> {
  await registration.showNotification(item.title, {
    body: item.body,
    icon: '/icons/app-icon.svg',
    badge: '/icons/app-icon.svg',
    tag: item.tag,
    data: {
      notifyAt: item.notifyAt,
      category: item.category,
      ...item.data,
    },
  })

  registration.active?.postMessage({
    type: 'MARK_NOTIFICATION_SENT',
    date: todayISODate(),
    tag: item.tag,
  })
}

function buildNotificationTag(category: NotificationCategory, id: string, date: string): string {
  return `${category}-${date}-${id}`
}

function hasNotificationBeenSent(tag: string, date: string): boolean {
  return readSentNotificationsState(date).tags.includes(tag)
}

function markNotificationSent(tag: string, date: string): void {
  const state = readSentNotificationsState(date)
  if (state.tags.includes(tag)) return

  const nextState: SentNotificationsState = {
    date,
    tags: [...state.tags, tag],
  }
  localStorage.setItem(SENT_NOTIFICATIONS_KEY, JSON.stringify(nextState))
}

function clearSentNotificationsState(date: string): void {
  const state = readSentNotificationsState(date)
  if (state.tags.length === 0) return
  localStorage.setItem(SENT_NOTIFICATIONS_KEY, JSON.stringify({ date, tags: [] }))
}

function readSentNotificationsState(date: string): SentNotificationsState {
  const raw = localStorage.getItem(SENT_NOTIFICATIONS_KEY)
  if (!raw) return { date, tags: [] }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'date' in parsed &&
      'tags' in parsed &&
      typeof parsed.date === 'string' &&
      Array.isArray(parsed.tags)
    ) {
      if (parsed.date !== date) return { date, tags: [] }
      return {
        date,
        tags: parsed.tags.filter((item): item is string => typeof item === 'string'),
      }
    }
  } catch {
    return { date, tags: [] }
  }

  return { date, tags: [] }
}

function isDueWithinGraceWindow(notifyAt: number): boolean {
  const now = Date.now()
  return notifyAt <= now && now - notifyAt <= LATE_DELIVERY_GRACE_MS
}

function atTime(now: Date, h: number, m: number): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0).getTime()
}

function todayISODate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

async function postMessageToNotificationWorker(
  registration: ServiceWorkerRegistration,
  message: Record<string, unknown>,
): Promise<void> {
  const worker = registration.active ?? registration.waiting ?? registration.installing
  if (!worker) return

  await new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    const timeoutId = window.setTimeout(() => resolve(), 1500)

    channel.port1.onmessage = () => {
      window.clearTimeout(timeoutId)
      resolve()
    }

    worker.postMessage(message, [channel.port2])
  })
}
