// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const mocks = vi.hoisted(() => ({
  consentEnabled: false,
  userId: 'user-1' as string | null,
  getMissingConsents: vi.fn(),
  hydrateConsents: vi.fn(),
  syncWhoopNow: vi.fn(),
  getWhoopStatus: vi.fn(),
}))

vi.mock('../../services/readiness/whoopApi', () => ({
  getWhoopStatus: mocks.getWhoopStatus,
  syncWhoopNow: mocks.syncWhoopNow,
}))
vi.mock('../../services/legal/consentFlag', () => ({
  isConsentEnforcementEnabled: () => mocks.consentEnabled,
}))
vi.mock('../../services/legal/consentService', () => ({
  getMissingConsents: mocks.getMissingConsents,
  hydrateConsents: mocks.hydrateConsents,
}))
vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } | null }) => unknown) => selector({
    user: mocks.userId ? { id: mocks.userId } : null,
  }),
}))
vi.mock('../../services/readiness/pullReadiness', () => ({
  pullReadiness: vi.fn(async () => { calls.push('pullReadiness') }),
}))
vi.mock('../../services/readiness/pullWorkouts', () => ({
  pullWorkouts: vi.fn(async () => { calls.push('pullWorkouts') }),
}))
vi.mock('../../services/readiness/autoCompleteFromWorkouts', () => ({
  autoCompleteFromWorkouts: vi.fn(async () => { calls.push('autoComplete') }),
}))

import { pullWorkouts } from '../../services/readiness/pullWorkouts'
import { syncWhoopAndRefreshLocalData, useWhoopSync } from '../useWhoopSync'

describe('useWhoopSync', () => {
  beforeEach(() => {
    calls.length = 0
    mocks.consentEnabled = false
    mocks.userId = 'user-1'
    mocks.getMissingConsents.mockReset().mockResolvedValue([])
    mocks.hydrateConsents.mockReset().mockResolvedValue({ ok: true })
    mocks.syncWhoopNow.mockReset().mockImplementation(async () => {
      calls.push('sync')
      return { ok: true }
    })
    mocks.getWhoopStatus.mockReset().mockResolvedValue({
      connected: true,
      lastSyncAt: null,
      lastSyncStatus: null,
      scopes: [],
    })
  })

  afterEach(() => cleanup())

  it('pulls workouts and auto-completes after a successful manual sync', async () => {
    await syncWhoopAndRefreshLocalData()
    expect(calls).toEqual(['sync', 'pullReadiness', 'pullWorkouts', 'autoComplete'])
  })

  it('does not run the matcher when the workout pull fails', async () => {
    vi.mocked(pullWorkouts).mockRejectedValueOnce(new Error('network down'))
    await syncWhoopAndRefreshLocalData()
    expect(calls).toEqual(['sync', 'pullReadiness'])
  })

  it('hydrates a missing local mirror before dispatching sync', async () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents
      .mockResolvedValueOnce(['whoop_biometric'])
      .mockResolvedValueOnce([])
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => {
      await result.current.syncNow()
    })

    expect(mocks.hydrateConsents).toHaveBeenCalledWith('user-1')
    expect(mocks.syncWhoopNow).toHaveBeenCalledOnce()
    expect(result.current.message).toBe('Whoop sincronizado.')
  })

  it('does not sync or offer acceptance when remote hydration fails', async () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents.mockResolvedValue(['whoop_biometric'])
    mocks.hydrateConsents.mockResolvedValue({ ok: false })
    const { result } = renderHook(() => useWhoopSync())

    let response: unknown
    await act(async () => {
      response = await result.current.syncNow()
    })

    expect(response).toBeNull()
    expect(mocks.syncWhoopNow).not.toHaveBeenCalled()
    expect(result.current.message).toBe(
      'No pudimos verificar tu consentimiento biométrico. Revisá tu conexión.',
    )
  })

  it('does not dispatch when hydration confirms the current version is missing', async () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents.mockResolvedValue(['whoop_biometric'])
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => {
      await result.current.syncNow()
    })

    expect(mocks.syncWhoopNow).not.toHaveBeenCalled()
    expect(result.current.message).toBe(
      'Aceptá el descargo biométrico en Ajustes para reanudar la sincronización.',
    )
  })

  it('translates a server consent_required response instead of showing a generic error', async () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents.mockResolvedValue([])
    mocks.syncWhoopNow.mockResolvedValue({
      ok: false,
      reason: 'error',
      code: 'consent_required',
      error: 'Consentimiento biométrico requerido.',
    })
    const { result } = renderHook(() => useWhoopSync())

    let response: unknown
    await act(async () => {
      response = await result.current.syncNow()
    })

    expect(response).toMatchObject({ ok: false, code: 'consent_required' })
    expect(result.current.message).toBe(
      'Aceptá el descargo biométrico en Ajustes para reanudar la sincronización.',
    )
  })

  it('preserves the pre-feature sync path when the client flag is off', async () => {
    mocks.consentEnabled = false
    mocks.getMissingConsents.mockResolvedValue(['whoop_biometric'])
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => {
      await result.current.syncNow()
    })

    expect(mocks.getMissingConsents).not.toHaveBeenCalled()
    expect(mocks.hydrateConsents).not.toHaveBeenCalled()
    expect(mocks.syncWhoopNow).toHaveBeenCalledOnce()
  })
})
