const CACHE_NAME = 'entrenador-app-v1'
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/icons/app-icon.svg',
]

const NOTIFICATION_STATE_CACHE = 'entrenador-notifications-v1'
const NOTIFICATION_STATE_URL = '/__notification_state__'
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
    scheduleNotificationTimers(state)
  })())
})

self.addEventListener('message', (event) => {
  const type = event.data?.type
  if (type === 'SCHEDULE_NOTIFICATIONS') {
    event.waitUntil(handleScheduleNotifications(event.data))
    return
  }
  if (type === 'MARK_NOTIFICATION_SENT') {
    event.waitUntil(markNotificationSent(event.data?.date, event.data?.tag))
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((client) => client.url.includes(self.location.origin))
      if (existing) return existing.focus()
      return self.clients.openWindow('/')
    }),
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
    sessions: Array.isArray(payload?.sessions) ? payload.sessions : [],
    sentTags: state.date === payload?.date ? state.sentTags : [],
  }

  await writeNotificationState(nextState)
  scheduleNotificationTimers(nextState)
}

function scheduleNotificationTimers(state) {
  clearNotificationTimers()

  const now = Date.now()
  for (const session of state.sessions) {
    if (!session || typeof session.tag !== 'string') continue
    if (state.sentTags.includes(session.tag)) continue

    const delay = session.notifyAt - now
    if (delay <= 0) continue

    const timeoutId = setTimeout(() => {
      void fireScheduledNotification(session, state.date)
    }, delay)

    notifTimers.set(session.tag, timeoutId)
  }
}

async function fireScheduledNotification(session, date) {
  const state = await readNotificationState()
  if (state.date !== date) return
  if (state.sentTags.includes(session.tag)) return

  await self.registration.showNotification('Sesion en 30 min', {
    body: session.title,
    icon: '/icons/app-icon.svg',
    badge: '/icons/app-icon.svg',
    tag: session.tag,
    renotify: false,
    data: {
      sessionId: session.id,
      type: session.type,
      notifyAt: session.notifyAt,
      source: 'service-worker',
    },
  })

  await markNotificationSent(date, session.tag)
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
    : { date, sessions: state.sessions, sentTags: [] }

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
    return { date: '', sessions: [], sentTags: [] }
  }

  try {
    const parsed = await response.json()
    return {
      date: typeof parsed?.date === 'string' ? parsed.date : '',
      sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
      sentTags: Array.isArray(parsed?.sentTags) ? parsed.sentTags.filter((tag) => typeof tag === 'string') : [],
    }
  } catch {
    return { date: '', sessions: [], sentTags: [] }
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
