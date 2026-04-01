const CACHE_NAME = 'entrenador-app-v1'
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/icons/app-icon.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

// ─── Notification scheduling ──────────────────────────────────────────────────

const _notifTimers = []

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'SCHEDULE_NOTIFICATIONS') return

  // Clear any previously scheduled timers
  _notifTimers.forEach((id) => clearTimeout(id))
  _notifTimers.length = 0

  const sessions = event.data.sessions ?? []
  const now = Date.now()

  for (const session of sessions) {
    const delay = session.notifyAt - now
    if (delay <= 0) continue

    const id = setTimeout(() => {
      self.registration.showNotification('Sesion en 30 min', {
        body: session.title,
        icon: '/icons/app-icon.svg',
        badge: '/icons/app-icon.svg',
        tag: `session-${session.id}`,
        renotify: false,
      })
    }, delay)

    _notifTimers.push(id)
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin))
      if (existing) return existing.focus()
      return self.clients.openWindow('/')
    }),
  )
})

// ─── Fetch cache ──────────────────────────────────────────────────────────────

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
