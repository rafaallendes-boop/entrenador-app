// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
const mocks = vi.hoisted(() => ({ enforce: vi.fn(), entitlement: null as unknown as UseBoundStore<StoreApi<{ accountRole: string }>> }))
vi.mock('../../services/athlete/coachScopeGuard', () => ({ enforceCoachScopeGuard: mocks.enforce }))
const user = { id: 'user' }
vi.mock('../../store/useAuthStore', () => ({ useAuthStore: <T,>(selector: (state: { user: { id: string }; activeAthleteId: string }) => T) => selector({ user, activeAthleteId: 'managed' }) }))
vi.mock('../../store/useEntitlementStore', () => ({ useEntitlementStore: <T,>(selector: (state: { accountRole: string }) => T) => mocks.entitlement(selector) }))
import CoachScopeGuard from './CoachScopeGuard'
afterEach(cleanup)
it('vuelve a evaluar la revocación al confirmar rol sin cambiar usuario ni atleta', () => {
  mocks.entitlement = create(() => ({ accountRole: 'unknown' }))
  mocks.enforce.mockClear()
  render(<CoachScopeGuard />)
  expect(mocks.enforce).toHaveBeenCalledTimes(1)
  act(() => mocks.entitlement.setState({ accountRole: 'athlete' }))
  expect(mocks.enforce).toHaveBeenCalledTimes(2)
})
