import type { Session } from '../types'

// Default notify time per time block (30 min before the expected session start)
const NOTIFY_TIME: Record<string, { h: number; m: number }> = {
  AM: { h: 7, m: 30 },   // 30 min before 8:00 AM
  PM: { h: 17, m: 30 },  // 30 min before 18:00 PM
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

  const sw = await navigator.serviceWorker.ready
  if (!sw.active) return

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const payload = sessions
    .filter(s => s.date === todayStr && s.status === 'planned')
    .map(s => {
      const time = NOTIFY_TIME[s.timeBlock] ?? NOTIFY_TIME.AM
      const notifyAt = new Date(
        now.getFullYear(), now.getMonth(), now.getDate(),
        time.h, time.m, 0,
      ).getTime()
      return { id: s.id, title: s.title, type: s.type, notifyAt }
    })
    .filter(s => s.notifyAt > Date.now())

  sw.active.postMessage({ type: 'SCHEDULE_NOTIFICATIONS', sessions: payload })
}
