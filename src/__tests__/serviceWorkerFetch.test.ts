import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const ORIGIN = 'https://entrenadoralph.netlify.app'

type FetchHandler = (event: { request: unknown; respondWith: (value: unknown) => void }) => void

function loadServiceWorker() {
  const source = readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8')
  const listeners = new Map<string, FetchHandler>()
  const cache = { put: vi.fn(async () => undefined), addAll: vi.fn(async () => undefined), match: vi.fn(async () => undefined) }
  const caches = {
    open: vi.fn(async () => cache),
    match: vi.fn(async () => undefined),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  }
  const fetchMock = vi.fn(async () => ({ ok: true, clone: () => ({}) }))
  const context = {
    self: {
      location: new URL(ORIGIN),
      addEventListener: (type: string, handler: FetchHandler) => listeners.set(type, handler),
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn(), matchAll: vi.fn(async () => []), openWindow: vi.fn() },
      registration: { showNotification: vi.fn() },
    },
    caches,
    fetch: fetchMock,
    Response: { error: () => ({}) },
    URL,
    console,
    setTimeout,
    clearTimeout,
  }
  createContext(context)
  runInContext(source, context)

  const onFetch = listeners.get('fetch')
  if (!onFetch) throw new Error('service worker did not register a fetch listener')
  return { caches, fetchMock, onFetch }
}

function dispatchGet(onFetch: FetchHandler, url: string) {
  const respondWith = vi.fn()
  onFetch({ request: { method: 'GET', url, mode: 'cors' }, respondWith })
  return respondWith
}

describe('service worker fetch policy', () => {
  it('lets API calls reach the network instead of serving them from the cache', () => {
    const { caches, onFetch } = loadServiceWorker()

    const respondWith = dispatchGet(onFetch, `${ORIGIN}/.netlify/functions/whoop-status`)

    // Whoop status changes whenever the athlete connects, reconnects or grants a
    // new scope. A cache-first answer keeps Settings showing a stale connection.
    expect(respondWith).not.toHaveBeenCalled()
    expect(caches.match).not.toHaveBeenCalled()
  })

  it('still serves static assets cache-first', () => {
    const { onFetch } = loadServiceWorker()

    const respondWith = dispatchGet(onFetch, `${ORIGIN}/icons/app-icon.svg`)

    expect(respondWith).toHaveBeenCalledTimes(1)
  })
})
