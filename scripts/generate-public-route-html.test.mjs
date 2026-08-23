import { describe, expect, it } from 'vitest'
import { routeHtml } from './generate-public-route-html.mjs'

const TEMPLATE = `<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <!-- route-metadata:start -->
  <meta name="description" content="default description" />
  <meta name="robots" content="noindex, nofollow" />
  <!-- route-metadata:end -->
  <title>RallyIQ</title>
</head>
<body></body>
</html>
`

const ROUTE = { path: '/pricing', title: 'Planes | RallyIQ', description: 'Compara planes.' }

describe('routeHtml', () => {
  it('overrides the noindex default to index, follow for a public route', () => {
    const html = routeHtml(TEMPLATE, ROUTE, 'https://app.rallyiq.cl', 'RallyIQ', '/og/rallyiq.png')

    expect(html).toContain('<meta name="robots" content="index, follow" />')
    expect(html).not.toContain('noindex')
  })

  it('still asserts on the metadata markers — a template missing them must fail loud, not silently keep the noindex default', () => {
    const brokenTemplate = TEMPLATE.replace('<!-- route-metadata:start -->', '')

    expect(() => routeHtml(brokenTemplate, ROUTE, 'https://app.rallyiq.cl', 'RallyIQ', '/og/rallyiq.png'))
      .toThrow(/route-metadata:start/)
  })
})
