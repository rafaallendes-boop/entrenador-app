import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import LandingPage from './LandingPage'
import FeaturesPage from './FeaturesPage'
import PricingPage from './PricingPage'

const LEGAL_HREFS = ['/terms', '/privacy', '/health-disclaimer', '/whoop-disclaimer'] as const

describe('public funnel legal links', () => {
  it.each([
    ['landing', <LandingPage />],
    ['features', <FeaturesPage />],
    ['pricing', <PricingPage />],
  ])('links all four legal surfaces from %s', (_name, page) => {
    const html = renderToStaticMarkup(<MemoryRouter>{page}</MemoryRouter>)

    LEGAL_HREFS.forEach((href) => {
      expect(html).toContain(`href="${href}"`)
    })
  })
})
