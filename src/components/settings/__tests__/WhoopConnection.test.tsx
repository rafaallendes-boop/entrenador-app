import { renderToStaticMarkup } from 'react-dom/server'
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

describe('WhoopConnection reconnect notice', () => {
  beforeEach(() => {
    mockStatus.scopes = ['offline', 'read:recovery']
  })

  it('shows a reconnect action when read:workout is missing', () => {
    const html = renderToStaticMarkup(<WhoopConnection />)
    expect(html).toContain('Reconecta Whoop para sincronizar entrenamientos.')
    expect(html).toContain('Reconectar Whoop')
  })

  it('hides the notice after read:workout is granted', () => {
    mockStatus.scopes = ['offline', 'read:workout']
    const html = renderToStaticMarkup(<WhoopConnection />)
    expect(html).not.toContain('Reconecta Whoop para sincronizar entrenamientos.')
  })
})
