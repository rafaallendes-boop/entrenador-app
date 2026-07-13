import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ROUTES } from '../../constants/routes'
import LegalPageLayout from './LegalPageLayout'

describe('LegalPageLayout', () => {
  it('renders the eyebrow, title, update date and children', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LegalPageLayout eyebrow="Legal" title="Título de prueba" metaRoute={ROUTES.TERMS} updatedAt="2026-07-13">
          <p>Contenido de prueba</p>
        </LegalPageLayout>
      </MemoryRouter>,
    )

    expect(html).toContain('Legal')
    expect(html).toContain('Título de prueba')
    expect(html).toContain('2026-07-13')
    expect(html).toContain('Contenido de prueba')
  })

  it('links the RallyIQ wordmark back to home', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LegalPageLayout eyebrow="Legal" title="X" metaRoute={ROUTES.TERMS} updatedAt="2026-07-13">
          <p>x</p>
        </LegalPageLayout>
      </MemoryRouter>,
    )

    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>\s*RallyIQ/)
  })
})
