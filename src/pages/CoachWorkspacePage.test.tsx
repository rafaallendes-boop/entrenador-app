import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'

import type { Athlete } from '../types'
import type { CoachWorkspaceTab } from '../components/coach/coachWorkspaceTypes'
import { coachTabId, coachTabPanelId } from '../components/coach/coachWorkspaceTypes'

// zustand v5 usa getInitialState() como server snapshot: renderToStaticMarkup
// (SSR) ignora setState. Mock con estado mutable para inyectar user/activeAthleteId.
const { authState } = vi.hoisted(() => ({
  authState: {
    user: null as unknown,
    activeAthleteId: null as string | null,
    syncDetails: {
      lastSuccessfulSyncAt: null as number | null,
      lastErrorAt: null as number | null,
    },
  },
}))
vi.mock('../store/useAuthStore', () => {
  const useAuthStore = (selector: (state: typeof authState) => unknown) => selector(authState)
  useAuthStore.setState = (patch: Partial<typeof authState>) => { Object.assign(authState, patch) }
  useAuthStore.getState = () => authState
  return { useAuthStore }
})
// Mismo motivo que el mock de auth: SSR lee getInitialState(), así que el rol
// de cuenta se inyecta con estado mutable. El default reproduce el arranque
// real: `unknown` y sin hidratar.
const { entitlementState } = vi.hoisted(() => ({
  entitlementState: { accountRole: 'unknown' as 'athlete' | 'coach' | 'unknown', hydrated: false },
}))
vi.mock('../store/useEntitlementStore', () => {
  const useEntitlementStore = (selector: (state: typeof entitlementState) => unknown) => selector(entitlementState)
  useEntitlementStore.setState = (patch: Partial<typeof entitlementState>) => { Object.assign(entitlementState, patch) }
  useEntitlementStore.getState = () => entitlementState
  return { useEntitlementStore }
})

import CoachWorkspacePage from './CoachWorkspacePage'
import { useAuthStore } from '../store/useAuthStore'
import { setActiveAthleteId, setSelfAthleteId } from '../services/athlete/activeAthlete'

const SELF: Athlete = { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 }
const MANAGED: Athlete = { id: 'ath_m_abc', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 }
const ARCHIVED: Athlete = { id: 'ath_m_old', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente antigua', status: 'archived', createdAt: 1, updatedAt: 1 }

// renderToStaticMarkup no ejecuta efectos → initialAthletes inyecta el roster
// que en runtime carga el useEffect (listRosterAthletes).
function render(
  allowlist: string,
  initialAthletes: Athlete[] = [],
  initialTab?: CoachWorkspaceTab,
  initialArchivedAthletes: Athlete[] = [],
) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/coach']}>
      <Routes>
        <Route
          path="/coach"
          element={(
            <CoachWorkspacePage
              allowlistOverride={allowlist}
              initialAthletes={initialAthletes}
              initialArchivedAthletes={initialArchivedAthletes}
              initialTab={initialTab}
            />
          )}
        />
        <Route path="/" element={<p>HOME</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CoachWorkspacePage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user-1', email: 'rafa@x.cl' } as User, activeAthleteId: 'ath_user-1' })
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
  })

  afterEach(() => {
    useAuthStore.setState({ user: null, activeAthleteId: null })
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    entitlementState.accountRole = 'unknown'
    entitlementState.hydrated = false
  })

  /** Entrega 2, paso 1: `account_role` habilita la UI; la allowlist es puente. */
  describe('gate por rol de cuenta', () => {
    it('rol coach entra sin estar en la allowlist', () => {
      entitlementState.accountRole = 'coach'
      entitlementState.hydrated = true
      const html = render('', [SELF, MANAGED])
      expect(html).toContain('Workspace de coach')
    })

    // `<Navigate>` no redirige bajo renderToStaticMarkup: el marcador de que
    // se decidió expulsar es que no queda ni workspace ni estado de carga.
    it('rol athlete confirmado y fuera de la allowlist: expulsa', () => {
      entitlementState.accountRole = 'athlete'
      entitlementState.hydrated = true
      const html = render('otra@persona.cl')
      expect(html).not.toContain('Workspace de coach')
      expect(html).not.toContain('Cargando tu espacio de coach')
    })

    it('rol sin resolver: no decide todavía, ni entra ni expulsa', () => {
      entitlementState.accountRole = 'unknown'
      entitlementState.hydrated = false
      const html = render('otra@persona.cl')
      expect(html).not.toContain('Workspace de coach')
      expect(html).toContain('Cargando tu espacio de coach')
    })

    it('la allowlist sigue entrando aunque el rol sea athlete (puente)', () => {
      entitlementState.accountRole = 'athlete'
      entitlementState.hydrated = true
      const html = render('rafa@x.cl', [SELF, MANAGED])
      expect(html).toContain('Workspace de coach')
    })
  })

  it('no-coach entrando manualmente a /coach: no renderiza el workspace', () => {
    const html = render('otra@persona.cl')
    expect(html).not.toContain('Workspace de coach')
  })

  it('coach allowlisted: por defecto muestra el tab Resumen con CTAs de semana/plan', () => {
    const html = render('rafa@x.cl', [SELF, MANAGED])
    expect(html).toContain('Workspace de coach')
    expect(html).toContain('Ver semana')
    expect(html).toContain('Ver plan')
  })

  it('coach nuevo con solo self: el tab Resumen invita a agregar el primer alumno', () => {
    const html = render('rafa@x.cl', [SELF])
    expect(html).toContain('Aún no agregaste alumnos')
  })

  it('tab Alumnos: muestra el roster con CTA de crear atleta', () => {
    const html = render('rafa@x.cl', [SELF, MANAGED], 'alumnos')
    expect(html).toContain('Crear atleta')
    expect(html).toContain('Entrenar como este atleta')
  })

  it('tab Alumnos recibe y muestra el roster archivado', () => {
    const html = render('rafa@x.cl', [SELF, MANAGED], 'alumnos', [ARCHIVED])
    expect(html).toContain('Archivados (1)')
    expect(html).toContain('data-archived-row="ath_m_old"')
    expect(html).toContain('Restaurar')
    expect(html).toContain('Eliminar definitivamente')
  })

  it('tab Planificación muestra el panel semanal real', () => {
    const html = render('rafa@x.cl', [SELF], 'planificacion')
    expect(html).toContain('id="planning-athlete"')
    expect(html).toContain('Semana anterior')
    expect(html).not.toContain('Vas a poder crear y editar sesiones')
  })

  it('Biblioteca y Asistente IA montan sus paneles reales', () => {
    const biblioteca = render('rafa@x.cl', [SELF], 'biblioteca')
    expect(biblioteca).toContain('Nueva plantilla')
    expect(biblioteca).not.toContain('Vas a poder guardar tus ejercicios')
    const asistente = render('rafa@x.cl', [SELF], 'asistente')
    expect(asistente).not.toContain('proponer cambios de sesión, semana o plan')
    expect(asistente).not.toContain('vos')
  })

  it('el tabpanel activo referencia el tab activo via aria-labelledby/aria-controls', () => {
    const html = render('rafa@x.cl', [SELF, MANAGED], 'alumnos')
    expect(html).toContain(`id="${coachTabPanelId('alumnos')}"`)
    expect(html).toContain(`aria-labelledby="${coachTabId('alumnos')}"`)
  })
  it('cuenta coach sin self: el roster no muestra "Tú" y lista al transferido', () => {
    entitlementState.accountRole = 'coach'
    entitlementState.hydrated = true
    setSelfAthleteId(null)
    setActiveAthleteId(null)
    useAuthStore.setState({ user: { id: 'coach-1', email: 'c@x.cl' } as User, activeAthleteId: null })
    const transferred: Athlete = { id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'Transferido', status: 'active', createdAt: 1, updatedAt: 1 }

    const html = render('', [transferred], 'alumnos')

    expect(html).toContain('Transferido')
    expect(html).not.toContain('>Tú<')
  })

})
