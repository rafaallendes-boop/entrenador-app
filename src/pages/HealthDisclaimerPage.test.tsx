import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import HealthDisclaimerPage from './HealthDisclaimerPage'

describe('HealthDisclaimerPage', () => {
  it('renders the title and the core disclaimer language', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HealthDisclaimerPage />
      </MemoryRouter>,
    )

    expect(html).toContain('Descargo de responsabilidad de salud')
    expect(html).toContain('No es un dispositivo médico')
    expect(html).toContain('bajo tu propio riesgo')
  })
})
