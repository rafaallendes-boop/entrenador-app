import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'

import type { Athlete } from '../types'

// zustand v5 usa getInitialState() como server snapshot: renderToStaticMarkup
// (SSR) ignora setState. Mock con estado mutable para inyectar user/activeAthleteId.
const { authState } = vi.hoisted(() => ({
  authState: { user: null as unknown, activeAthleteId: null as string | null },
}))
vi.mock('../store/useAuthStore', () => {
  const useAuthStore = (selector: (state: typeof authState) => unknown) => selector(authState)
  useAuthStore.setState = (patch: Partial<typeof authState>) => { Object.assign(authState, patch) }
  useAuthStore.getState = () => authState
  return { useAuthStore }
})

import CoachRosterPage from './CoachRosterPage'
import { useAuthStore } from '../store/useAuthStore'
import { setActiveAthleteId, setSelfAthleteId } from '../services/athlete/activeAthlete'

const ROSTER: Athlete[] = [
  { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 },
  { id: 'ath_m_abc', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 },
]

// renderToStaticMarkup no ejecuta efectos → initialAthletes inyecta el roster
// que en runtime carga el useEffect (listOwnedAthletes).
function render(allowlist: string, initialAthletes: Athlete[] = []) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/coach']}>
      <Routes>
        <Route path="/coach" element={<CoachRosterPage allowlistOverride={allowlist} initialAthletes={initialAthletes} />} />
        <Route path="/" element={<p>HOME</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CoachRosterPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user-1', email: 'rafa@x.cl' } as User, activeAthleteId: 'ath_user-1' })
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
  })

  afterEach(() => {
    useAuthStore.setState({ user: null, activeAthleteId: null })
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('no-coach entrando manualmente a /coach: redirige a home', () => {
    // renderToStaticMarkup no sigue el redirect, pero el markup del roster no debe aparecer
    const html = render('otra@persona.cl')
    expect(html).not.toContain('Mis atletas')
  })

  it('coach allowlisted con solo self: ve su card "Tú" y el CTA de crear', () => {
    const html = render('rafa@x.cl', [ROSTER[0]])
    expect(html).toContain('Mis atletas')
    expect(html).toContain('Tú')
    expect(html).toContain('Entrenando ahora') // self activo, sin botón de switch
    expect(html).toContain('Crear atleta')
  })

  it('con gestionado en el roster: card con nombre real y botón de switch', () => {
    const html = render('rafa@x.cl', ROSTER)
    expect(html).toContain('Cliente 1')
    expect(html).toContain('Entrenar como este atleta')
  })
})
