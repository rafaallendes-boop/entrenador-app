import type { User } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

// Zustand's SSR snapshot ignores setState, so inject mutable state for static rendering.
const { authState } = vi.hoisted(() => ({
  authState: {
    user: null as unknown,
    signInWithGoogle: async () => {},
  },
}))
vi.mock('../store/useAuthStore', () => {
  const useAuthStore = (selector: (state: typeof authState) => unknown) => selector(authState)
  useAuthStore.setState = (patch: Partial<typeof authState>) => { Object.assign(authState, patch) }
  return { useAuthStore }
})

import { useAuthStore } from '../store/useAuthStore'
import CoachesLandingPage from './CoachesLandingPage'
import PricingPage from './PricingPage'

const BETA_BADGE = 'Beta cerrada · sin cobro todavía'
const BETA_CTA = 'Pedir acceso a la beta'

function renderPricing(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <PricingPage />
    </MemoryRouter>,
  )
}

/** Asuntos decodificados de cada `mailto:` presente en el marcado. */
function mailtoSubjects(html: string): string[] {
  return [...html.matchAll(/href="mailto:([^"?]+)\?subject=([^"]+)"/g)]
    .map(([, address, subject]) => `${address}|${decodeURIComponent(subject!)}`)
}

afterEach(() => {
  useAuthStore.setState({ user: null })
})

describe('PricingPage — beta cerrada sin cobro', () => {
  it('marca como beta cerrada sólo los dos tiers pagados', () => {
    const html = renderPricing()

    expect(html.match(new RegExp(BETA_BADGE, 'g')) ?? []).toHaveLength(2)
  })

  it('ofrece pedir acceso en los tiers pagados y conserva el alta gratuita en Base', () => {
    const html = renderPricing()

    expect(html.match(new RegExp(BETA_CTA, 'g')) ?? []).toHaveLength(2)
    expect(html).toContain('Empezar gratis')
    expect(html).not.toContain('Probar Coach Semanal')
    expect(html).not.toContain('Preparar un objetivo')
  })

  it('abre un mailto con el plan solicitado en el asunto', () => {
    const subjects = mailtoSubjects(renderPricing())

    expect(subjects).toContain('hola@rallyiq.cl|Quiero acceso a la beta de RallyIQ — plan Coach Semanal')
    expect(subjects).toContain('hola@rallyiq.cl|Quiero acceso a la beta de RallyIQ — plan Avanzado')
  })

  it('codifica el asunto para que el href no lleve espacios crudos', () => {
    const hrefs = [...renderPricing().matchAll(/href="(mailto:[^"]+\?subject=[^"]+)"/g)]
      .map(([, href]) => href!)

    expect(hrefs).toHaveLength(2)
    for (const href of hrefs) expect(href).not.toMatch(/\s/)
  })

  it('mantiene el pedido de acceso aunque la sesión esté iniciada, porque seguir logueado no habilita el cobro', () => {
    useAuthStore.setState({ user: { id: 'signed-in-user' } as User })
    const html = renderPricing()

    expect(html.match(new RegExp(BETA_CTA, 'g')) ?? []).toHaveLength(2)
    expect(html).toContain('Ir a mi panel')
  })

  it('comparte la dirección de prelanzamiento con la landing de coaches', () => {
    const pricingAddresses = new Set(mailtoSubjects(renderPricing()).map((entry) => entry.split('|')[0]))
    const coachesHtml = renderToStaticMarkup(
      <MemoryRouter>
        <CoachesLandingPage />
      </MemoryRouter>,
    )
    const coachesAddresses = new Set(mailtoSubjects(coachesHtml).map((entry) => entry.split('|')[0]))

    expect(coachesAddresses.size).toBeGreaterThan(0)
    expect([...pricingAddresses]).toEqual([...coachesAddresses])
  })
})
