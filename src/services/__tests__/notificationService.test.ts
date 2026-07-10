import { describe, expect, it, vi } from 'vitest'
import {
  createNativeNotificationService,
  stableNotificationId,
} from '../notificationService'

describe('notification service abstraction', () => {
  it('uses a stable positive identifier for replacement and cancellation', () => {
    expect(stableNotificationId('session-2026-07-10-a')).toBe(stableNotificationId('session-2026-07-10-a'))
    expect(stableNotificationId('session-2026-07-10-a')).toBeGreaterThanOrEqual(0)
  })

  it('replaces a native reminder with the same stable id', async () => {
    const plugin = {
      checkPermissions: vi.fn(async () => ({ display: 'granted' as const })),
      requestPermissions: vi.fn(async () => ({ display: 'granted' as const })),
      cancel: vi.fn(async () => undefined),
      schedule: vi.fn(async (options: { notifications: Array<{ id: number }> }) => ({
        notifications: options.notifications.map(({ id }) => ({ id })),
      })),
    }
    const service = createNativeNotificationService(plugin)
    const request = {
      stableId: 'session-reminder-1',
      title: 'Sesión en 30 min',
      body: 'Running Z2',
      at: new Date('2026-07-10T07:30:00'),
    }

    await service.scheduleSessionReminder(request)
    await service.scheduleSessionReminder(request)

    const id = stableNotificationId(request.stableId)
    expect(plugin.cancel).toHaveBeenLastCalledWith({ notifications: [{ id }] })
    expect(plugin.schedule).toHaveBeenCalledTimes(2)
  })
})
