import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
// The build script is the second consumer of publicRouteMetadata.json; importing it
// here is what guarantees the prerendered <head> and the React <head> cannot drift.
import { loadMetadata, routeHtml } from '../../scripts/generate-public-route-html.mjs'
import {
  DEFAULT_ROUTE_METADATA,
  PUBLIC_ROUTE_METADATA,
  getPublicRouteMetadata,
} from './publicRouteMetadata'
import { ROUTES } from './routes'

const PUBLIC_PATHS = [
  ROUTES.HOME,
  ROUTES.FEATURES,
  ROUTES.PRICING,
  ROUTES.COACHES,
  ROUTES.TERMS,
  ROUTES.PRIVACY,
  ROUTES.HEALTH_DISCLAIMER,
  ROUTES.WHOOP_DISCLAIMER,
] as const

describe('public route metadata', () => {
  it('registers every public route exactly once', () => {
    expect(PUBLIC_ROUTE_METADATA.map((route) => route.path).sort()).toEqual([...PUBLIC_PATHS].sort())
  })

  it('gives every route a non-empty, unique title and description', () => {
    const titles = new Set<string>()
    for (const route of PUBLIC_ROUTE_METADATA) {
      expect(route.title.trim().length, `title for ${route.path}`).toBeGreaterThan(0)
      expect(route.description.trim().length, `description for ${route.path}`).toBeGreaterThan(0)
      expect(titles.has(route.title), `duplicate title for ${route.path}`).toBe(false)
      titles.add(route.title)
    }
  })

  it('throws instead of silently shipping default metadata for an unregistered route', () => {
    expect(() => getPublicRouteMetadata('/not-a-public-route')).toThrow(/No public metadata registered/)
  })

  it('uses "/" as the reset target for routes that never set their own metadata', () => {
    expect(DEFAULT_ROUTE_METADATA.path).toBe(ROUTES.HOME)
  })

  it('is the single source shared with the prerender script', async () => {
    const { routes } = await loadMetadata()
    expect(routes).toEqual(PUBLIC_ROUTE_METADATA)
  })
})

describe('prerendered route HTML', () => {
  const ORIGIN = 'https://app.rallyiq.cl'

  async function template() {
    return readFile(new URL('../../index.html', import.meta.url), 'utf8')
  }

  it('injects the route title, description, canonical and og:image', async () => {
    const html = routeHtml(
      await template(),
      getPublicRouteMetadata(ROUTES.COACHES),
      ORIGIN,
      'RallyIQ',
      '/og/rallyiq.png',
    )

    expect(html).toContain('<title>RallyIQ para coaches | Planifica y gestiona atletas</title>')
    expect(html).toContain('<meta property="og:url" content="https://app.rallyiq.cl/coaches" />')
    expect(html).toContain('<meta property="og:image" content="https://app.rallyiq.cl/og/rallyiq.png" />')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(html).toContain('<link rel="canonical" href="https://app.rallyiq.cl/coaches" />')
    // The app-shell defaults must be gone, not merely appended to.
    expect(html).not.toContain('<title>RallyIQ</title>')
  })

  it('escapes HTML-significant characters in copy', () => {
    const html = routeHtml(
      '<html><head><!-- route-metadata:start --><!-- route-metadata:end --><title>x</title></head></html>',
      { path: '/x', title: 'A & "B"', description: '<script>' },
      ORIGIN,
      'RallyIQ',
      '/og/rallyiq.png',
    )

    expect(html).toContain('<title>A &amp; &quot;B&quot;</title>')
    expect(html).toContain('content="&lt;script&gt;"')
    expect(html).not.toContain('<script>')
  })

  it('fails loudly when index.html loses the metadata markers', () => {
    expect(() =>
      routeHtml(
        '<html><head><meta name="description" content="x" /><title>x</title></head></html>',
        getPublicRouteMetadata(ROUTES.TERMS),
        ORIGIN,
        'RallyIQ',
        '/og/rallyiq.png',
      ),
    ).toThrow(/missing the .*route-metadata/)
  })

  it('fails loudly when index.html loses its <title>', () => {
    expect(() =>
      routeHtml(
        '<html><head><!-- route-metadata:start --><!-- route-metadata:end --></head></html>',
        getPublicRouteMetadata(ROUTES.TERMS),
        ORIGIN,
        'RallyIQ',
        '/og/rallyiq.png',
      ),
    ).toThrow(/missing a plain <title>/)
  })

  it('keeps the real index.html compatible with the generator for every route', async () => {
    const source = await template()
    for (const route of PUBLIC_ROUTE_METADATA) {
      expect(() => routeHtml(source, route, ORIGIN, 'RallyIQ', '/og/rallyiq.png'), route.path).not.toThrow()
    }
  })
})
