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
import PricingPage from './PricingPage'

afterEach(() => {
  useAuthStore.setState({ user: null })
})

describe('PricingPage authenticated state', () => {
  it('replaces every signup CTA with a link back to the panel', () => {
    useAuthStore.setState({ user: { id: 'signed-in-user' } as User })

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PricingPage />
      </MemoryRouter>,
    )

    expect(html).toContain('Ir a mi panel')
    expect(html).not.toContain('Iniciar sesión')
    expect(html).not.toContain('Empezar gratis')
    expect(html).not.toContain('Probar Coach Semanal')
    expect(html).not.toContain('Preparar un objetivo')
  })
})
