import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LEGAL_CONTROLLER_NAME, MINORS_POLICY_COPY } from '../constants/legal'
import TermsPage from './TermsPage'

describe('TermsPage', () => {
  it('renders the controller, adults-only rule, contact and payment status', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    )

    expect(html).toContain('Términos y Condiciones')
    expect(html).toContain(LEGAL_CONTROLLER_NAME)
    expect(html).toContain(MINORS_POLICY_COPY)
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
