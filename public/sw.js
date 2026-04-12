const CACHE_NAME = 'entrenador-app-v1'
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/icons/app-icon.svg',
]

const NOTIFICATION_STATE_CACHE = 'entrenador-notifications-v1'
const NOTIFICATION_STATE_URL = '/__notification_state__'
const DEFAULT_NOTIFICATION_GRACE_MS = 90 * 60 * 1000
const notifTimers = new Map()

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME && key !== NOTIFICATION_STATE_CACHE)
        .map((key) => caches.delete(key)),
    )
    await self.clients.claim()
    const state = await readNotificationState()
    await scheduleNotificationTimers(state)
  })())
})

self.addEventListener('message', (event) => {
  const type = event.data?.type
  if (type === 'SCHEDULE_NOTIFICATIONS') {
    event.waitUntil(handleScheduleNotifications(event.data).then(() => {
      event.ports[0]?.postMessage({ ok: true })
    }))
    return
  }
  if (type === 'CLEAR_NOTIFICATIONS') {
    event.waitUntil(handleClearNotifications(event.data).then(() => {
      event.ports[0]?.postMessage({ ok: true })
    }))
    return
  }
  if (type === 'MARK_NOTIFICATION_SENT') {
    event.waitUntil(markNotificationSent(event.data?.date, event.data?.tag).then(() => {
      event.ports[0]?.postMessage({ ok: true })
    }))
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const data = event.notification.data || {}
      const url = typeof data.url === 'string' && data.url.length > 0 ? data.url : '/'
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = clients.find((client) => client.url.includes(self.location.origin))
      if (existing) {
        await existing.focus()
        if (typeof existing.navigate === 'function') {
          await existing.navigate(url)
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin) return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put('/', copy))
          return response
        })
        .catch(async () => {
          const cached = await caches.match(event.request)
          return cached || caches.match('/') || Response.error()
        }),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached

      return fetch(event.request).then((response) => {
        if (!response.ok) return response
        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        return response
      })
    }),
  )
})

async function handleScheduleNotifications(payload) {
  const state = await readNotificationState()
  const nextState = {
    date: typeof payload?.date === 'string' ? payload.date : state.date,
    notifications: Array.isArray(payload?.notifications) ? payload.notifications : [],
    sentTags: state.date === payload?.date ? state.sentTags : [],
    recoveredTags: state.date === payload?.date ? state.recoveredTags : [],
    graceMs: typeof payload?.graceMs === 'number' && Number.isFinite(payload.graceMs)
      ? payload.graceMs
      : state.graceMs,
    lastSyncedAt: typeof payload?.lastSyncedAt === 'number' && Number.isFinite(payload.lastSyncedAt)
      ? payload.lastSyncedAt
      : Date.now(),
    lastClearReason: null,
  }

  await writeNotificationState(nextState)
  await scheduleNotificationTimers(nextState)
}

async function handleClearNotifications(payload) {
  clearNotificationTimers()
  const state = await readNotificationState()
  const nextState = {
    date: typeof payload?.date === 'string' ? payload.date : state.date,
    notifications: [],
    sentTags: [],
    recoveredTags: [],
    graceMs: state.graceMs,
    lastSyncedAt: typeof payload?.lastSyncedAt === 'number' && Number.isFinite(payload.lastSyncedAt)
      ? payload.lastSyncedAt
      : Date.now(),
    lastClearReason: typeof payload?.reason === 'string' ? payload.reason : 'manual-clear',
  }

  await writeNotificationState(nextState)
}

async function scheduleNotificationTimers(state) {
  clearNotificationTimers()

  const normalizedState = await flushOverdueNotifications(state)
  const now = Date.now()
  for (const item of normalizedState.notifications) {
    if (!item || typeof item.tag !== 'string') continue
    if (normalizedState.sentTags.includes(item.tag)) continue

    const delay = item.notifyAt - now
    if (delay <= 0) continue

    const timeoutId = setTimeout(() => {
      void fireScheduledNotification(item, normalizedState.date)
    }, delay)

    notifTimers.set(item.tag, timeoutId)
  }
}

async function fireScheduledNotification(item, date) {
  const state = await readNotificationState()
  if (state.date !== date) return
  if (state.sentTags.includes(item.tag)) return

  await self.registration.showNotification(item.title, {
    body: item.body,
    icon: '/icons/app-icon.svg',
    badge: '/icons/app-icon.svg',
    tag: item.tag,
    renotify: false,
    data: {
      notifyAt: item.notifyAt,
      category: item.category,
      source: 'service-worker',
      ...(item.data ?? {}),
    },
  })

  await markNotificationSent(date, item.tag)
}

function clearNotificationTimers() {
  for (const timeoutId of notifTimers.values()) {
    clearTimeout(timeoutId)
  }
  notifTimers.clear()
}

async function markNotificationSent(date, tag) {
  if (typeof date !== 'string' || typeof tag !== 'string') return

  const state = await readNotificationState()
  const nextState = state.date === date
    ? state
    : {
        date,
        notifications: state.notifications,
        sentTags: [],
        recoveredTags: state.recoveredTags,
        graceMs: state.graceMs,
        lastSyncedAt: state.lastSyncedAt,
        lastClearReason: state.lastClearReason,
      }

  if (!nextState.sentTags.includes(tag)) {
    nextState.sentTags = [...nextState.sentTags, tag]
    await writeNotificationState(nextState)
  }

  const timeoutId = notifTimers.get(tag)
  if (timeoutId != null) {
    clearTimeout(timeoutId)
    notifTimers.delete(tag)
  }
}

async function readNotificationState() {
  const cache = await caches.open(NOTIFICATION_STATE_CACHE)
  const response = await cache.match(NOTIFICATION_STATE_URL)
  if (!response) {
    return {
      date: '',
      notifications: [],
      sentTags: [],
      recoveredTags: [],
      graceMs: DEFAULT_NOTIFICATION_GRACE_MS,
      lastSyncedAt: null,
      lastClearReason: null,
    }
  }

  try {
    const parsed = await response.json()
    return {
      date: typeof parsed?.date === 'string' ? parsed.date : '',
      notifications: Array.isArray(parsed?.notifications)
        ? parsed.notifications
        : Array.isArray(parsed?.sessions)
        ? parsed.sessions
        : [],
      sentTags: Array.isArray(parsed?.sentTags) ? parsed.sentTags.filter((tag) => typeof tag === 'string') : [],
      recoveredTags: Array.isArray(parsed?.recoveredTags) ? parsed.recoveredTags.filter((tag) => typeof tag === 'string') : [],
      graceMs: typeof parsed?.graceMs === 'number' && Number.isFinite(parsed.graceMs)
        ? parsed.graceMs
        : DEFAULT_NOTIFICATION_GRACE_MS,
      lastSyncedAt: typeof parsed?.lastSyncedAt === 'number' && Number.isFinite(parsed.lastSyncedAt)
        ? parsed.lastSyncedAt
        : null,
      lastClearReason: typeof parsed?.lastClearReason === 'string' ? parsed.lastClearReason : null,
    }
  } catch {
    return {
      date: '',
      notifications: [],
      sentTags: [],
      recoveredTags: [],
      graceMs: DEFAULT_NOTIFICATION_GRACE_MS,
      lastSyncedAt: null,
      lastClearReason: null,
    }
  }
}

async function writeNotificationState(state) {
  const cache = await caches.open(NOTIFICATION_STATE_CACHE)
  await cache.put(
    NOTIFICATION_STATE_URL,
    new Response(JSON.stringify(state), {
      headers: { 'content-type': 'application/json' },
    }),
  )
}

async function flushOverdueNotifications(state) {
  const graceMs = typeof state.graceMs === 'number' && Number.isFinite(state.graceMs)
    ? state.graceMs
    : DEFAULT_NOTIFICATION_GRACE_MS
  const now = Date.now()
  const nextState = {
    ...state,
    notifications: [],
    sentTags: Array.isArray(state.sentTags) ? [...state.sentTags] : [],
    recoveredTags: Array.isArray(state.recoveredTags) ? [...state.recoveredTags] : [],
    graceMs,
  }

  for (const item of Array.isArray(state.notifications) ? state.notifications : []) {
    if (!item || typeof item.tag !== 'string' || typeof item.notifyAt !== 'number') continue
    if (nextState.sentTags.includes(item.tag)) {
      nextState.notifications.push(item)
      continue
    }

    if (item.notifyAt > now) {
      nextState.notifications.push(item)
      continue
    }

    if (now - item.notifyAt <= graceMs) {
      await fireScheduledNotification(item, state.date)
      nextState.sentTags.push(item.tag)
      if (!nextState.recoveredTags.includes(item.tag)) {
        nextState.recoveredTags.push(item.tag)
      }
      nextState.notifications.push(item)
    }
  }

  await writeNotificationState(nextState)
  return nextState
}
