import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStatus: {
  connected: boolean
  lastSyncAt: null
  lastSyncStatus: null
  scopes: string[]
} = {
  connected: true,
  lastSyncAt: null,
  lastSyncStatus: null,
  scopes: ['offline', 'read:recovery'],
}

vi.mock('../../../hooks/useWhoopSync', () => ({
  useWhoopSync: () => ({
    apiAvailable: true,
    clearMessage: vi.fn(),
    message: null,
    refreshStatus: vi.fn(async () => mockStatus),
    status: mockStatus,
    syncing: false,
    syncNow: vi.fn(),
  }),
}))
vi.mock('../../../services/readiness/whoopApi', () => ({
  disconnectWhoop: vi.fn(),
  startWhoopConnect: vi.fn(async () => 'https://whoop.test/oauth'),
}))
vi.mock('../../../services/readiness/localReadiness', () => ({
  clearLocalWhoopReadiness: vi.fn(),
  clearLocalWhoopWorkouts: vi.fn(),
}))
vi.mock('../../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: () => 'ath_1',
  getSelfAthleteId: () => 'ath_1',
}))
vi.mock('../../../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: { activeAthleteId: string }) => unknown) => (
    selector({ activeAthleteId: 'ath_1' })
  ),
}))

import { WhoopConnection } from '../WhoopConnection'

// WhoopConnection reads the OAuth outcome (?whoop=…&reason=…) off the location,
// so it only renders inside a router — as it does in the app, under SettingsPage.
function render(search = '') {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/settings${search}`]}>
      <WhoopConnection />
    </MemoryRouter>,
  )
}

describe('WhoopConnection reconnect notice', () => {
  beforeEach(() => {
    mockStatus.scopes = ['offline', 'read:recovery']
  })

  it('shows a reconnect action when read:workout is missing', () => {
    const html = render()
    expect(html).toContain('Reconecta Whoop para sincronizar entrenamientos.')
    expect(html).toContain('Reconectar Whoop')
  })

  it('hides the notice after read:workout is granted', () => {
    mockStatus.scopes = ['offline', 'read:workout']
    const html = render()
    expect(html).not.toContain('Reconecta Whoop para sincronizar entrenamientos.')
  })
})

describe('WhoopConnection OAuth redirect outcome', () => {
  beforeEach(() => {
    mockStatus.scopes = ['offline', 'read:recovery', 'read:workout']
  })

  it('confirms a successful connection', () => {
    expect(render('?whoop=connected')).toContain('Whoop conectado.')
  })

  it('explains a denied authorization instead of failing silently', () => {
    expect(render('?whoop=error&reason=authorization_denied')).toContain(
      'No se autorizó la conexión con Whoop.',
    )
  })

  it('falls back to a generic message for an unknown error reason', () => {
    const html = render('?whoop=error&reason=something_new')
    expect(html).toContain('No se pudo completar la conexión con Whoop.')
  })

  it('says nothing when the user simply opened Settings', () => {
    const html = render()
    expect(html).not.toContain('Whoop conectado.')
    expect(html).not.toContain('No se pudo completar la conexión con Whoop.')
  })
})
