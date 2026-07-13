import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import CoachesLandingPage from './CoachesLandingPage'

describe('CoachesLandingPage', () => {
  it('renders the hero, Para quién es and Qué no es blocks', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoachesLandingPage />
      </MemoryRouter>,
    )

    expect(html).toContain('Gestiona el entrenamiento de tus atletas')
    expect(html).toContain('Para quién es')
    expect(html).toContain('Qué no es')
  })

  it('uses one consistent prelaunch CTA and destination everywhere', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoachesLandingPage />
      </MemoryRouter>,
    )
    const ctaMatches = html.match(/Avisarme del lanzamiento/g) ?? []
    const mailtoMatches = html.match(/mailto:hola@rallyiq\.cl\?subject=/g) ?? []

    expect(ctaMatches).toHaveLength(3)
    expect(mailtoMatches).toHaveLength(ctaMatches.length)
    expect(html).not.toContain('Empezar gratis')
    expect(html).not.toContain('Solicitar demo')
  })

  it('does not reuse the athlete-funnel navigation', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoachesLandingPage />
      </MemoryRouter>,
    )

    expect(html).not.toContain('Iniciar sesión')
    expect(html).not.toContain('SharedPublicNav')
  })

  it('uses honest Whoop and AI language', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoachesLandingPage />
      </MemoryRouter>,
    )

    expect(html).toContain('contexto objetivo opcional')
    expect(html).toContain('nunca diagnostica ni ajusta un plan automáticamente')
  })

  it('links the four legal routes without claiming screenshots that do not exist yet', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoachesLandingPage />
      </MemoryRouter>,
    )

    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/health-disclaimer"')
    expect(html).toContain('href="/whoop-disclaimer"')
    expect(html).not.toContain('/coaches/screenshots/')
    expect(html).not.toContain('Capturas reales del producto')
  })
})
