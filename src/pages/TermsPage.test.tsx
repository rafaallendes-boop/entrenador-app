import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import TermsPage from './TermsPage'

const CONTROLLER_NAME = 'Rafael Allendes'
const MINORS_POLICY =
  'RallyIQ no está disponible para personas menores de 18 años ni permite registrar datos de atletas menores de 18 años durante esta etapa.'

describe('TermsPage', () => {
  it('renders the controller, adults-only rule, contact and payment status', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    )

    expect(html).toContain('Términos y Condiciones')
    expect(html).toContain(CONTROLLER_NAME)
    expect(html).toContain(MINORS_POLICY)
    expect(html).toContain('hola@rallyiq.cl')
    expect(html).toContain('aún no habilita contratación ni cobros')
    expect(html).not.toContain('[[')
  })

  it('links to the health disclaimer and privacy policy', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    )

    expect(html).toContain('href="/health-disclaimer"')
    expect(html).toContain('href="/privacy"')
  })
})
