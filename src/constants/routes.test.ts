import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROUTES } from './routes'

describe('ROUTES', () => {
  it('defines the public routes for Coaches Landing Fase 0', () => {
    expect(ROUTES.COACHES).toBe('/coaches')
    expect(ROUTES.TERMS).toBe('/terms')
    expect(ROUTES.PRIVACY).toBe('/privacy')
    expect(ROUTES.HEALTH_DISCLAIMER).toBe('/health-disclaimer')
    expect(ROUTES.WHOOP_DISCLAIMER).toBe('/whoop-disclaimer')
  })

  it('keeps the existing public routes unchanged', () => {
    expect(ROUTES.FEATURES).toBe('/features')
    expect(ROUTES.PRICING).toBe('/pricing')
  })

  it('serves built metadata HTML before Netlify falls back to the SPA shell', () => {
    const netlifyConfig = readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8')
    const fallbackIndex = netlifyConfig.indexOf('from = "/*"')

    Object.values({
      features: ROUTES.FEATURES,
      pricing: ROUTES.PRICING,
      coaches: ROUTES.COACHES,
      terms: ROUTES.TERMS,
      privacy: ROUTES.PRIVACY,
      health: ROUTES.HEALTH_DISCLAIMER,
      whoop: ROUTES.WHOOP_DISCLAIMER,
    }).forEach((route) => {
      const rewriteIndex = netlifyConfig.indexOf(`from = "${route}"`)
      expect(rewriteIndex).toBeGreaterThan(-1)
      expect(rewriteIndex).toBeLessThan(fallbackIndex)
      expect(netlifyConfig).toContain(`to = "${route}/index.html"`)
    })
  })
})
