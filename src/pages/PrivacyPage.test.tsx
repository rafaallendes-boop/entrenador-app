import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import PrivacyPage from './PrivacyPage'

const CONTROLLER_NAME = 'Rafael Allendes'
const MINORS_POLICY =
  'RallyIQ no está disponible para personas menores de 18 años ni permite registrar datos de atletas menores de 18 años durante esta etapa.'

describe('PrivacyPage', () => {
  it('renders the controller, contact, adults-only rule and accurate Chilean-law dates', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    )

    expect(html).toContain('Política de Privacidad')
    expect(html).toContain(CONTROLLER_NAME)
    expect(html).toContain('hola@rallyiq.cl')
    expect(html).toContain('Ley 19.628')
    expect(html).toContain('Ley 21.719')
    expect(html).toContain('1 de diciembre de 2026')
    expect(html).toContain(MINORS_POLICY)
    expect(html).not.toContain('[[')
  })

  it('uses the required opt-in, non-diagnostic Whoop language', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    )

    expect(html).toContain('contexto objetivo opcional y consentido')
    expect(html).toContain('no se usan para diagnosticar')
  })
})
