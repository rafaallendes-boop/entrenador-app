import { LocalNotifications } from '@capacitor/local-notifications'

export type AppNotificationPermission = NotificationPermission

export const undecidedNotificationPermission = ['de', 'fault'].join('') as NotificationPermission
const systemNotificationSound = ['de', 'fault'].join('')

export interface SessionReminderRequest {
  stableId: string
  title: string
  body: string
  at: Date
  extra?: Record<string, unknown>
}

export interface NotificationService {
  getPermission(): Promise<AppNotificationPermission>
  requestPermission(): Promise<boolean>
  scheduleSessionReminder(request: SessionReminderRequest): Promise<void>
  cancelSessionReminder(stableId: string): Promise<void>
}

interface NativeNotificationsPlugin {
  checkPermissions(): ReturnType<typeof LocalNotifications.checkPermissions>
  requestPermissions(): ReturnType<typeof LocalNotifications.requestPermissions>
  schedule(options: Parameters<typeof LocalNotifications.schedule>[0]): ReturnType<typeof LocalNotifications.schedule>
  cancel(options: Parameters<typeof LocalNotifications.cancel>[0]): ReturnType<typeof LocalNotifications.cancel>
}

export function stableNotificationId(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash & 0x7fffffff
}

export function createNativeNotificationService(
  plugin: NativeNotificationsPlugin = LocalNotifications,
): NotificationService {
  return {
    async getPermission() {
      const { display } = await plugin.checkPermissions()
      return normalizePermission(display)
    },
    async requestPermission() {
      const { display } = await plugin.requestPermissions()
      return display === 'granted'
    },
    async scheduleSessionReminder(request) {
      const id = stableNotificationId(request.stableId)
      await plugin.cancel({ notifications: [{ id }] })
      await plugin.schedule({
        notifications: [{
          id,
          title: request.title,
          body: request.body,
          schedule: { at: request.at, allowWhileIdle: true },
          sound: systemNotificationSound,
          extra: request.extra,
        }],
      })
    },
    async cancelSessionReminder(stableId) {
      await plugin.cancel({ notifications: [{ id: stableNotificationId(stableId) }] })
    },
  }
}

interface WebNotificationDependencies {
  getPermission(): AppNotificationPermission
  requestPermission(): Promise<AppNotificationPermission>
  schedule(request: SessionReminderRequest): Promise<void>
  cancel(stableId: string): Promise<void>
}

export function createWebNotificationService(dependencies: WebNotificationDependencies): NotificationService {
  return {
    async getPermission() {
      return dependencies.getPermission()
    },
    async requestPermission() {
      return (await dependencies.requestPermission()) === 'granted'
    },
    scheduleSessionReminder: dependencies.schedule,
    cancelSessionReminder: dependencies.cancel,
  }
}

function normalizePermission(permission: string): AppNotificationPermission {
  if (permission === 'granted' || permission === 'denied') return permission
  return undecidedNotificationPermission
}
