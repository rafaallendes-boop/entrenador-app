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

  it('carries the shared public nav so a legal page is reachable from the rest of the site', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LegalPageLayout eyebrow="Legal" title="X" metaRoute={ROUTES.TERMS} updatedAt="2026-07-13">
          <p>x</p>
        </LegalPageLayout>
      </MemoryRouter>,
    )

    // El wordmark propio se retiró al montar `SharedPublicNav`: dos marcas
    // apiladas eran redundantes. El camino a Inicio ahora lo da la nav.
    expect(html).toMatch(/href="\/"/)
    expect(html).toContain('RallyIQ')
    expect(html).toContain(ROUTES.FEATURES)
  })

  it('renders a section index built from the document headings', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LegalPageLayout
          eyebrow="Legal"
          title="X"
          metaRoute={ROUTES.TERMS}
          updatedAt="2026-07-13"
          sections={[
            { id: 'seccion-1', text: 'Qué es el servicio' },
            { id: 'seccion-2', text: 'Cuenta y acceso' },
          ]}
        >
          <p>x</p>
        </LegalPageLayout>
      </MemoryRouter>,
    )

    expect(html).toContain('En este documento')
    expect(html).toContain('href="#seccion-1"')
    expect(html).toContain('href="#seccion-2"')
    expect(html).toContain('2 secciones')
  })

  it('omits the index when the document has no headings', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LegalPageLayout eyebrow="Legal" title="X" metaRoute={ROUTES.TERMS} updatedAt="2026-07-13">
          <p>x</p>
        </LegalPageLayout>
      </MemoryRouter>,
    )

    expect(html).not.toContain('En este documento')
  })
})
