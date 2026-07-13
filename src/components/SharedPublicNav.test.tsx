import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import SharedPublicNav from './SharedPublicNav'

describe('SharedPublicNav', () => {
  it('sends authenticated users to their panel without rendering OAuth actions', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SharedPublicNav onLogin={vi.fn()} onSignup={vi.fn()} isAuthenticated />
      </MemoryRouter>,
    )

    expect(html).toContain('Ir a mi panel')
    expect(html).not.toContain('Iniciar sesión')
    expect(html).not.toContain('Empezar gratis')
  })

  it('keeps login and signup actions for visitors', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SharedPublicNav onLogin={vi.fn()} onSignup={vi.fn()} />
      </MemoryRouter>,
    )

    expect(html).toContain('Iniciar sesión')
    expect(html).toContain('Empezar gratis')
    expect(html).not.toContain('Ir a mi panel')
  })
})
