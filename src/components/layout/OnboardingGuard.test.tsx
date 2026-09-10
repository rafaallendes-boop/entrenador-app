// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { create, type UseBoundStore, type StoreApi } from 'zustand'

interface AuthState {
  user: { id: string }; activeAthleteId: string | null
  syncDetails: { syncAttemptInFlight: boolean; awaitingProfileRecreationAfterReset: boolean; memoryLoadRequiredAfterSyncAt: number; memoryLoadedForSyncAt: number }
}
interface EntitlementState { accountRole: string; hydrated: boolean; userId: string }
interface MemoryState { athleteProfile: null; hasLoaded: boolean }
type TestStore<T> = UseBoundStore<StoreApi<T>>
const stores = vi.hoisted(() => ({
  auth: null as unknown as TestStore<AuthState>,
  entitlement: null as unknown as TestStore<EntitlementState>,
  memory: null as unknown as TestStore<MemoryState>,
}))
vi.mock('../../store/useAuthStore', () => ({ useAuthStore: <T,>(selector: (state: AuthState) => T) => stores.auth(selector) }))
vi.mock('../../store/useEntitlementStore', () => ({ useEntitlementStore: <T,>(selector: (state: EntitlementState) => T) => stores.entitlement(selector) }))
vi.mock('../../store/useCoachMemoryStore', () => ({ useCoachMemoryStore: <T,>(selector: (state: MemoryState) => T) => stores.memory(selector) }))
vi.mock('../../services/auth', () => ({ isSupabaseConfigured: true }))
vi.mock('../../services/syncService', () => ({ hasInitialRemotePullCompleted: () => true }))
vi.mock('../../utils/onboarding', () => ({ hasSkippedOnboarding: () => false, needsOnboarding: () => true }))
import OnboardingGuard from './OnboardingGuard'

function Location() { return <span data-testid="location">{useLocation().pathname}</span> }
function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Location /><OnboardingGuard><span>Contenido</span></OnboardingGuard></MemoryRouter>)
}
beforeEach(() => {
  stores.auth = create<AuthState>(() => ({ user: { id: 'coach' }, activeAthleteId: null, syncDetails: {
    syncAttemptInFlight: false, awaitingProfileRecreationAfterReset: false,
    memoryLoadRequiredAfterSyncAt: 1, memoryLoadedForSyncAt: 1,
  } }))
  stores.entitlement = create<EntitlementState>(() => ({ accountRole: 'coach', hydrated: true, userId: 'coach' }))
  stores.memory = create<MemoryState>(() => ({ athleteProfile: null, hasLoaded: true }))
})
afterEach(cleanup)
describe('entrada de coach sin self', () => {
  it.each(['/', '/onboarding', '/week'])('envía %s al workspace', (path) => {
    mount(path)
    expect(screen.getByTestId('location').textContent).toBe('/coach')
  })
  it.each(['/coach', '/coach/alumnos', '/settings', '/ops'])('mantiene %s sin exigir perfil deportivo', (path) => {
    mount(path)
    expect(screen.getByTestId('location').textContent).toBe(path)
  })
  it('no monta el formulario mientras hidrata y reacciona al rol', () => {
    stores.entitlement.setState({ accountRole: 'unknown', hydrated: false })
    mount('/onboarding')
    expect(screen.queryByText('Contenido')).toBeNull()
    act(() => stores.entitlement.setState({ accountRole: 'coach', hydrated: true }))
    expect(screen.getByTestId('location').textContent).toBe('/coach')
  })
  it('no usa el rol hidratado de la cuenta anterior', () => {
    stores.entitlement.setState({ userId: 'previous' })
    mount('/onboarding')
    expect(screen.queryByText('Contenido')).toBeNull()
  })
  it('mantiene onboarding del gestionado seleccionado', () => {
    stores.auth.setState({ activeAthleteId: 'managed' })
    mount('/week')
    expect(screen.getByTestId('location').textContent).toBe('/onboarding')
  })
  it('el workspace no redirige aunque el gestionado no tenga perfil', () => {
    stores.auth.setState({ activeAthleteId: 'managed' })
    mount('/coach')
    expect(screen.getByTestId('location').textContent).toBe('/coach')
  })
  it('mantiene onboarding del atleta sin fila de entitlements', () => {
    stores.entitlement.setState({ accountRole: 'athlete' })
    mount('/')
    expect(screen.getByTestId('location').textContent).toBe('/onboarding')
  })
})
