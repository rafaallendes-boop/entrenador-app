export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return

  window.addEventListener('load', () => {
    if (import.meta.env.DEV || isLocalHost(window.location.hostname)) {
      void unregisterLocalServiceWorkers()
      return
    }

    navigator.serviceWorker
      .register('/sw.js')
      .catch((error) => {
        console.error('Service worker registration failed', error)
      })
  })
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

async function unregisterLocalServiceWorkers(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))

    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith('entrenador-'))
          .map((key) => caches.delete(key)),
      )
    }
  } catch (error) {
    console.warn('[pwa] failed to clear local service worker', error)
  }
}
