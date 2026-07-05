import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'

import type { Athlete } from '../../types'

// zustand v5 usa getInitialState() como server snapshot: renderToStaticMarkup
// (SSR) ignora setState y ve el estado inicial. Mockeamos useAuthStore con un
// estado mutable para poder inyectar user/activeAthleteId en el render estático.
const { authState } = vi.hoisted(() => ({
  authState: { user: null as unknown, activeAthleteId: null as string | null },
}))
vi.mock('../../store/useAuthStore', () => {
  const useAuthStore = (selector: (state: typeof authState) => unknown) => selector(authState)
  useAuthStore.setState = (patch: Partial<typeof authState>) => { Object.assign(authState, patch) }
  useAuthStore.getState = () => authState
  return { useAuthStore }
})

import CoachContextBar from './CoachContextBar'
import { useAuthStore } from '../../store/useAuthStore'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'

const ROSTER: Athlete[] = [
  { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 },
  { id: 'ath_m_abc', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 },
]

// renderToStaticMarkup no ejecuta efectos → initialAthletes inyecta el roster
// que en runtime carga el useEffect (listOwnedAthletes).
function render(allowlist: string, initialAthletes: Athlete[] = []) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <CoachContextBar allowlistOverride={allowlist} initialAthletes={initialAthletes} />
    </MemoryRouter>,
  )
}

describe('CoachContextBar', () => {
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

  it('cuenta fuera de la allowlist: no renderiza nada', () => {
    expect(render('otra@persona.cl')).toBe('')
  })

  it('coach allowlisted con solo self: renderiza el pill "Tú" (bootstrap del primer gestionado)', () => {
    const html = render('rafa@x.cl')
    expect(html).toContain('Tú')
  })

  it('gestionado activo: renderiza el banner con el nombre real + "Volver a ti"', () => {
    useAuthStore.setState({ activeAthleteId: 'ath_m_abc' })
    setActiveAthleteId('ath_m_abc')
    const html = render('rafa@x.cl', ROSTER)
    expect(html).toContain('Entrenando a Cliente 1')
    expect(html).toContain('Volver a ti')
  })
})
