import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import WhoopDisclaimerPage from './WhoopDisclaimerPage'

describe('WhoopDisclaimerPage', () => {
  it('renders the title and the required non-diagnostic, opt-in language', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <WhoopDisclaimerPage />
      </MemoryRouter>,
    )

    expect(html).toContain('Descargo y consentimiento para datos Whoop')
    expect(html).toContain('opcional')
    expect(html).toContain('no se usan para diagnosticar')
    expect(html).toContain('No recibimos tus credenciales de Whoop')
  })
})
