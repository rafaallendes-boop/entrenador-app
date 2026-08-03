// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  consentEnabled: false,
  status: {
    connected: false,
    lastSyncAt: null as string | null,
    lastSyncStatus: null as 'ok' | 'error' | null,
    scopes: ['offline', 'read:recovery'] as string[],
  },
  getMissingConsents: vi.fn(),
  hydrateConsents: vi.fn(),
  verifyCurrentConsentRemotely: vi.fn(),
  refreshStatus: vi.fn(),
  syncNow: vi.fn(),
  startWhoopConnect: vi.fn(),
}))

vi.mock('../../../hooks/useWhoopSync', () => ({
  useWhoopSync: () => ({
    apiAvailable: true,
    clearMessage: vi.fn(),
    message: null,
    refreshStatus: mocks.refreshStatus,
    status: mocks.status,
    syncing: false,
    syncNow: mocks.syncNow,
  }),
}))
vi.mock('../../../services/legal/consentFlag', () => ({
  isConsentEnforcementEnabled: () => mocks.consentEnabled,
}))
vi.mock('../../../services/legal/consentService', () => ({
  getMissingConsents: mocks.getMissingConsents,
  hydrateConsents: mocks.hydrateConsents,
  verifyCurrentConsentRemotely: mocks.verifyCurrentConsentRemotely,
}))
vi.mock('../../legal/ConsentScreen', () => ({
  default: (props: { variant?: string; isUpdate?: boolean; onAccepted: () => void }) => (
    <div data-testid="consent-screen" data-variant={props.variant} data-update={String(props.isUpdate)}>
      <button type="button" onClick={props.onAccepted}>Aceptar consentimiento</button>
    </div>
  ),
}))
vi.mock('../../../services/readiness/whoopApi', () => ({
  disconnectWhoop: vi.fn(),
  isWhoopConsentRequiredError: (error: unknown) => (
    typeof error === 'object' && error != null && (error as { code?: unknown }).code === 'consent_required'
  ),
  startWhoopConnect: mocks.startWhoopConnect,
}))
vi.mock('../../../services/readiness/localReadiness', () => ({
  clearLocalWhoopReadiness: vi.fn(),
  clearLocalWhoopWorkouts: vi.fn(),
}))
vi.mock('../../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: () => 'ath_1',
  getSelfAthleteId: () => 'ath_1',
}))
vi.mock('../../../services/athlete/athleteScopeMigration', () => ({
  backfillLocalAthleteScope: vi.fn(),
}))
vi.mock('../../../services/athlete/hydrateActiveAthlete', () => ({
  hydrateActiveAthlete: vi.fn(),
}))
vi.mock('../../../store/useAuthStore', () => {
  const state = {
    activeAthleteId: 'ath_1',
    user: { id: 'user-1' },
    setActiveAthleteId: vi.fn(),
  }
  const useAuthStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  )
  return { useAuthStore }
})
vi.mock('../../../services/platform', () => ({ isNativePlatform: () => false }))

import { WhoopConnection } from '../WhoopConnection'

function renderConnection(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/settings${search}`]}>
      <WhoopConnection />
    </MemoryRouter>,
  )
}

describe('WhoopConnection consent UX', () => {
  beforeEach(() => {
    mocks.consentEnabled = false
    mocks.status.connected = false
    mocks.status.lastSyncAt = null
    mocks.status.lastSyncStatus = null
    mocks.status.scopes = ['offline', 'read:recovery']
    mocks.getMissingConsents.mockReset().mockResolvedValue([])
    mocks.hydrateConsents.mockReset().mockResolvedValue({ ok: true })
    mocks.verifyCurrentConsentRemotely.mockReset().mockResolvedValue({ ok: true, current: false })
    mocks.refreshStatus.mockReset().mockResolvedValue(mocks.status)
    mocks.syncNow.mockReset()
    mocks.startWhoopConnect.mockReset().mockResolvedValue('https://whoop.test/oauth')
  })

  afterEach(() => cleanup())

  it('preserves the legacy checkbox and disabled behavior when the flag is off', () => {
    renderConnection()

    const checkbox = screen.getByRole('checkbox')
    const connect = screen.getByRole('button', { name: 'Conectar Whoop' }) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    expect(mocks.getMissingConsents).not.toHaveBeenCalled()

    fireEvent.click(checkbox)
    expect(connect.disabled).toBe(false)
  })

  it('keeps connect disabled while checking consent', () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents.mockReturnValue(new Promise(() => undefined))

    renderConnection()

    expect(screen.getByText('Verificando tu consentimiento biométrico…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Conectar Whoop' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('enables connect when the local mirror already contains the current version', async () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents.mockResolvedValue([])

    renderConnection()

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Conectar Whoop' }) as HTMLButtonElement).disabled).toBe(false)
    })
    expect(mocks.hydrateConsents).not.toHaveBeenCalled()
  })

  it('hydrates before showing the inline acceptance screen when consent is missing', async () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents.mockResolvedValue(['whoop_biometric'])

    renderConnection()

    const consent = await screen.findByTestId('consent-screen')
    expect(consent.dataset.variant).toBe('inline')
    expect(consent.dataset.update).toBe('false')
    expect(mocks.hydrateConsents).toHaveBeenCalledWith('user-1')
    expect((screen.getByRole('button', { name: 'Conectar Whoop' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not offer acceptance when remote hydration is unavailable', async () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents.mockResolvedValue(['whoop_biometric'])
    mocks.hydrateConsents.mockResolvedValue({ ok: false })

    renderConnection()

    expect(await screen.findByText(/No pudimos verificar tu consentimiento biométrico/)).toBeTruthy()
    expect(screen.queryByTestId('consent-screen')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })

  it.each(['local lookup', 'remote hydration'] as const)(
    'moves to unavailable when the %s throws',
    async (failurePoint) => {
      mocks.consentEnabled = true
      if (failurePoint === 'local lookup') {
        mocks.getMissingConsents.mockRejectedValue(new Error('Dexie unavailable'))
      } else {
        mocks.getMissingConsents.mockResolvedValue(['whoop_biometric'])
        mocks.hydrateConsents.mockRejectedValue(new Error('Supabase unavailable'))
      }

      renderConnection()

      expect(await screen.findByText(/No pudimos verificar tu consentimiento biométrico/)).toBeTruthy()
      expect(screen.queryByTestId('consent-screen')).toBeNull()
      expect(screen.queryByText('Verificando tu consentimiento biométrico…')).toBeNull()
    },
  )

  it('hydrates an existing remote acceptance and reaches current state', async () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents
      .mockResolvedValueOnce(['whoop_biometric'])
      .mockResolvedValueOnce([])

    renderConnection()

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Conectar Whoop' }) as HTMLButtonElement).disabled).toBe(false)
    })
    expect(screen.queryByTestId('consent-screen')).toBeNull()
  })

  it('pauses a connected account and marks the inline screen as re-acceptance', async () => {
    mocks.consentEnabled = true
    mocks.status.connected = true
    mocks.getMissingConsents.mockResolvedValue(['whoop_biometric'])

    renderConnection()

    const consent = await screen.findByTestId('consent-screen')
    expect(consent.dataset.update).toBe('true')
    expect(screen.getByText('Pausamos la sincronización hasta que aceptes el descargo actualizado.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Sincronizar ahora' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Desconectar' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('traduce el 403 de OAuth a reaceptación tras confirmar que falta remoto', async () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents.mockResolvedValue([])
    mocks.startWhoopConnect.mockRejectedValue({ code: 'consent_required' })
    mocks.verifyCurrentConsentRemotely.mockResolvedValue({ ok: true, current: false })

    renderConnection()
    const connect = await screen.findByRole('button', { name: 'Conectar Whoop' })
    await waitFor(() => expect((connect as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(connect)

    expect(await screen.findByTestId('consent-screen')).toBeTruthy()
    expect(mocks.verifyCurrentConsentRemotely).toHaveBeenCalledWith('user-1', 'whoop_biometric')
  })

  it('muestra indisponibilidad si servidor y lectura remota discrepan', async () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents.mockResolvedValue([])
    mocks.startWhoopConnect.mockRejectedValue({ code: 'consent_required' })
    mocks.verifyCurrentConsentRemotely.mockResolvedValue({ ok: true, current: true })

    renderConnection()
    const connect = await screen.findByRole('button', { name: 'Conectar Whoop' })
    await waitFor(() => expect((connect as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(connect)

    expect(await screen.findByText(/No pudimos verificar tu consentimiento biométrico/)).toBeTruthy()
    expect(screen.queryByTestId('consent-screen')).toBeNull()
  })
})

describe('WhoopConnection existing behavior', () => {
  beforeEach(() => {
    mocks.consentEnabled = false
    mocks.status.connected = true
    mocks.status.scopes = ['offline', 'read:recovery']
    mocks.getMissingConsents.mockReset().mockResolvedValue([])
    mocks.hydrateConsents.mockReset().mockResolvedValue({ ok: true })
    mocks.verifyCurrentConsentRemotely.mockReset().mockResolvedValue({ ok: true, current: false })
    mocks.refreshStatus.mockReset().mockResolvedValue(mocks.status)
    mocks.startWhoopConnect.mockReset().mockResolvedValue('https://whoop.test/oauth')
  })

  afterEach(() => cleanup())

  it('shows a reconnect action when read:workout is missing', () => {
    renderConnection()
    expect(screen.getByText('Reconecta Whoop para sincronizar entrenamientos.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reconectar Whoop' })).toBeTruthy()
  })

  it('hides the reconnect notice after read:workout is granted', () => {
    mocks.status.scopes = ['offline', 'read:workout']
    renderConnection()

    expect(screen.queryByText('Reconecta Whoop para sincronizar entrenamientos.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reconectar Whoop' })).toBeNull()
  })

  it('confirms a successful OAuth connection', () => {
    renderConnection('?whoop=connected')
    expect(screen.getByText('Whoop conectado.')).toBeTruthy()
  })

  it('explains a denied OAuth authorization', () => {
    renderConnection('?whoop=error&reason=authorization_denied')
    expect(screen.getByText('No se autorizó la conexión con Whoop.')).toBeTruthy()
  })

  it('falls back to a generic message for an unknown OAuth error', () => {
    renderConnection('?whoop=error&reason=something_new')
    expect(screen.getByText('No se pudo completar la conexión con Whoop.')).toBeTruthy()
  })

  it('does not show an OAuth outcome when Settings is opened normally', () => {
    renderConnection()
    expect(screen.queryByText('Whoop conectado.')).toBeNull()
    expect(screen.queryByText('No se pudo completar la conexión con Whoop.')).toBeNull()
  })

  it('explains OAuth outcomes including consent_required', () => {
    renderConnection('?whoop=error&reason=consent_required')
    expect(screen.getByText('Aceptá el descargo biométrico para conectar Whoop.')).toBeTruthy()
  })
})
