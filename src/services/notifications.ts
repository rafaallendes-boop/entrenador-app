import type { Session } from '../types'

const NOTIFY_TIME: Record<string, { h: number; m: number }> = {
  AM: { h: 7, m: 30 },
  PM: { h: 17, m: 30 },
}

const SENT_NOTIFICATIONS_KEY = 'scheduled_session_notifications_v1'
const SYNC_INTERVAL_MS = 60_000
const LATE_DELIVERY_GRACE_MS = 90 * 60 * 1000

interface ScheduledSessionNotification {
  id: string
  title: string
  type: Session['type']
  notifyAt: number
  tag: string
}

interface SentNotificationsState {
  date: string
  tags: string[]
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

export async function scheduleTodayNotifications(sessions: Session[]): Promise<void> {
  if (!notificationsSupported()) return
  if (Notification.permission !== 'granted') return

  const registration = await navigator.serviceWorker.ready
  const today = todayISODate()
  const scheduled = buildScheduledNotifications(sessions, today)
  const dueNow = scheduled.filter((item) => isDueWithinGraceWindow(item.notifyAt) && !hasNotificationBeenSent(item.tag, today))
  const upcoming = scheduled.filter((item) => item.notifyAt > Date.now() && !hasNotificationBeenSent(item.tag, today))

  for (const item of dueNow) {
    await showSessionNotification(registration, item)
    markNotificationSent(item.tag, today)
  }

  registration.active?.postMessage({
    type: 'SCHEDULE_NOTIFICATIONS',
    date: today,
    sessions: upcoming,
  })
}

export function startNotificationSync(getSessions: () => Session[]): () => void {
  if (!notificationsSupported()) return () => undefined

  const sync = () => {
    void scheduleTodayNotifications(getSessions())
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

function buildScheduledNotifications(sessions: Session[], today: string): ScheduledSessionNotification[] {
  const now = new Date()

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
        title: session.title,
        type: session.type,
        notifyAt,
        tag: buildNotificationTag(session.id, today),
      }
    })
}

async function showSessionNotification(
  registration: ServiceWorkerRegistration,
  item: ScheduledSessionNotification,
): Promise<void> {
  await registration.showNotification('Sesion en 30 min', {
    body: item.title,
    icon: '/icons/app-icon.svg',
    badge: '/icons/app-icon.svg',
    tag: item.tag,
    data: {
      sessionId: item.id,
      type: item.type,
      notifyAt: item.notifyAt,
      source: 'page-sync',
    },
  })

  registration.active?.postMessage({
    type: 'MARK_NOTIFICATION_SENT',
    date: todayISODate(),
    tag: item.tag,
  })
}

function buildNotificationTag(sessionId: string, date: string): string {
  return `session-${date}-${sessionId}`
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

function todayISODate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
