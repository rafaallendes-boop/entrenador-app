// @vitest-environment jsdom

import { StrictMode } from 'react'
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

  it('sigue escribiendo estado despues del doble montaje de StrictMode', async () => {
    const { result } = renderHook(() => useWhoopSync(), { wrapper: StrictMode })

    await act(async () => {
      await result.current.syncNow()
    })

    expect(result.current.message).toBe('Whoop sincronizado.')
  })

  it('corre un solo sync cuando dos llamadas se solapan', async () => {
    let resolveSync: (value: { ok: boolean }) => void = () => {}
    mocks.syncWhoopNow
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSync = resolve as (value: { ok: boolean }) => void
      }))
      .mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useWhoopSync())

    let second: unknown
    await act(async () => {
      const first = result.current.syncNow()
      const secondCall = result.current.syncNow()
      resolveSync({ ok: true })
      const responses = await Promise.all([first, secondCall])
      second = responses[1]
    })

    expect(second).toBeNull()
    expect(mocks.syncWhoopNow).toHaveBeenCalledOnce()
  })

  it('vuelve a permitir sync despues de que uno falla', async () => {
    mocks.syncWhoopNow.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow() })
    mocks.syncWhoopNow.mockResolvedValue({ ok: true })
    await act(async () => { await result.current.syncNow() })

    expect(mocks.syncWhoopNow).toHaveBeenCalledTimes(2)
  })

  it('mantiene syncNow estable cuando cambia la identidad de onReadinessPulled', () => {
    const { result, rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useWhoopSync({ onReadinessPulled: cb }),
      { initialProps: { cb: () => {} } },
    )
    const first = result.current.syncNow

    rerender({ cb: () => {} })

    expect(result.current.syncNow).toBe(first)
  })

  it('llama al onReadinessPulled mas reciente, no al de la primera render', async () => {
    const stale = vi.fn()
    const fresh = vi.fn()
    const { result, rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useWhoopSync({ onReadinessPulled: cb }),
      { initialProps: { cb: stale } },
    )

    rerender({ cb: fresh })
    await act(async () => { await result.current.syncNow() })

    expect(fresh).toHaveBeenCalledOnce()
    expect(stale).not.toHaveBeenCalled()
  })

  it('no escribe mensaje en un sync silencioso exitoso', async () => {
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow({ silent: true }) })

    expect(result.current.message).toBeNull()
    expect(mocks.syncWhoopNow).toHaveBeenCalledOnce()
  })

  it('no escribe mensaje en un sync silencioso que cae en cooldown', async () => {
    mocks.syncWhoopNow.mockResolvedValue({ ok: false, reason: 'cooldown', retryAfterMs: 120_000 })
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow({ silent: true }) })

    expect(result.current.message).toBeNull()
  })

  it('no escribe mensaje en un sync silencioso con error generico del servidor', async () => {
    mocks.syncWhoopNow.mockResolvedValue({ ok: false, reason: 'error' })
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow({ silent: true }) })

    expect(result.current.message).toBeNull()
  })

  it('no escribe mensaje cuando un sync silencioso tira una excepcion', async () => {
    mocks.syncWhoopNow.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow({ silent: true }) })

    expect(result.current.message).toBeNull()
  })

  it('no borra un mensaje previo al arrancar un sync silencioso', async () => {
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow() })
    expect(result.current.message).toBe('Whoop sincronizado.')

    let resolveSync: (value: { ok: boolean }) => void = () => {}
    mocks.syncWhoopNow.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSync = resolve as (value: { ok: boolean }) => void
    }))

    let pending: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pending = result.current.syncNow({ silent: true })
      await Promise.resolve()
    })
    expect(result.current.message).toBe('Whoop sincronizado.')

    await act(async () => {
      resolveSync({ ok: true })
      await pending
    })
    expect(result.current.message).toBe('Whoop sincronizado.')
  })

  it('muestra consent_required detectado localmente aun en modo silencioso', async () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents.mockResolvedValue(['whoop_biometric'])
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow({ silent: true }) })

    expect(mocks.syncWhoopNow).not.toHaveBeenCalled()
    expect(result.current.message).toBe(
      'Aceptá el descargo biométrico en Ajustes para reanudar la sincronización.',
    )
  })

  it('muestra consent_required devuelto por el servidor aun en modo silencioso', async () => {
    mocks.syncWhoopNow.mockResolvedValue({
      ok: false, reason: 'error', code: 'consent_required',
    })
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow({ silent: true }) })

    expect(result.current.message).toBe(
      'Aceptá el descargo biométrico en Ajustes para reanudar la sincronización.',
    )
  })

  it('mantiene el spinner tambien en modo silencioso', async () => {
    let resolveSync: (value: { ok: boolean }) => void = () => {}
    mocks.syncWhoopNow.mockImplementation(() => new Promise((resolve) => {
      resolveSync = resolve as (value: { ok: boolean }) => void
    }))
    const { result } = renderHook(() => useWhoopSync())

    let pending: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pending = result.current.syncNow({ silent: true })
      await Promise.resolve()
    })
    expect(result.current.syncing).toBe(true)

    await act(async () => {
      resolveSync({ ok: true })
      await pending
    })
    expect(result.current.syncing).toBe(false)
  })

  it.each([
    [300_000, 'Whoop ya está al día. Puedes volver a sincronizar en 5 min.'],
    [287_000, 'Whoop ya está al día. Puedes volver a sincronizar en 5 min.'],
    [60_000, 'Whoop ya está al día. Puedes volver a sincronizar en 1 min.'],
    [59_000, 'Whoop ya está al día. Puedes volver a sincronizar en 59s.'],
    [1_000, 'Whoop ya está al día. Puedes volver a sincronizar en 1s.'],
  ])('formatea el cooldown de %ims redondeando hacia arriba', async (retryAfterMs, expected) => {
    mocks.syncWhoopNow.mockResolvedValue({ ok: false, reason: 'cooldown', retryAfterMs })
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow() })

    expect(result.current.message).toBe(expected)
  })

  // El efecto encadena refreshStatus -> shouldAutoSyncWhoop -> syncNow, o sea
  // varias vueltas de microtasks. Un flush por macrotask las drena todas.
  const flushEffects = () => act(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })

  const freshStatus = {
    connected: true,
    lastSyncAt: new Date(Date.now() - 60_000).toISOString(),
    lastSyncStatus: 'ok' as const,
    scopes: [],
  }

  it('sincroniza en silencio al montar cuando el estado esta viejo', async () => {
    const { result } = renderHook(() => useWhoopSync({ autoSync: true }))
    await flushEffects()

    // Dos: el preflight del efecto y el refresh que syncNow hace al terminar.
    expect(mocks.getWhoopStatus).toHaveBeenCalledTimes(2)
    expect(mocks.syncWhoopNow).toHaveBeenCalledOnce()
    expect(result.current.message).toBeNull()
  })

  it('no sincroniza al montar cuando el estado esta fresco, pero si lo refresca', async () => {
    mocks.getWhoopStatus.mockResolvedValue(freshStatus)

    renderHook(() => useWhoopSync({ autoSync: true }))
    await flushEffects()

    expect(mocks.getWhoopStatus).toHaveBeenCalledOnce()
    expect(mocks.syncWhoopNow).not.toHaveBeenCalled()
  })

  it('vuelve a sincronizar cuando el ultimo sync es reciente pero fallo', async () => {
    mocks.getWhoopStatus.mockResolvedValue({ ...freshStatus, lastSyncStatus: 'error' })

    renderHook(() => useWhoopSync({ autoSync: true }))
    await flushEffects()

    expect(mocks.syncWhoopNow).toHaveBeenCalledOnce()
  })

  it('no hace nada cuando autoSync esta apagado', async () => {
    renderHook(() => useWhoopSync({ autoSync: false }))
    await flushEffects()

    expect(mocks.getWhoopStatus).not.toHaveBeenCalled()
    expect(mocks.syncWhoopNow).not.toHaveBeenCalled()
  })

  it('no intenta sincronizar cuando el status falla', async () => {
    mocks.getWhoopStatus.mockRejectedValue(new Error('offline'))

    renderHook(() => useWhoopSync({ autoSync: true }))
    await flushEffects()

    expect(mocks.syncWhoopNow).not.toHaveBeenCalled()
  })

  it('cancela el sync si autoSync se apaga mientras el status esta en vuelo', async () => {
    let resolveStatus: (value: unknown) => void = () => {}
    mocks.getWhoopStatus.mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve }))

    const { rerender } = renderHook(
      ({ autoSync }: { autoSync: boolean }) => useWhoopSync({ autoSync }),
      { initialProps: { autoSync: true } },
    )

    rerender({ autoSync: false })
    resolveStatus({ connected: true, lastSyncAt: null, lastSyncStatus: null, scopes: [] })
    await flushEffects()

    expect(mocks.syncWhoopNow).not.toHaveBeenCalled()
  })

  it('no dispara un request por render con un onReadinessPulled sin memoizar', async () => {
    // Status fresco a proposito: sin sync de por medio, cualquier GET extra solo
    // puede venir de que el efecto se re-ejecuto, que es lo que se esta midiendo.
    mocks.getWhoopStatus.mockResolvedValue(freshStatus)

    const { rerender } = renderHook(
      () => useWhoopSync({ autoSync: true, onReadinessPulled: () => {} }),
    )
    await flushEffects()

    rerender()
    rerender()
    rerender()
    await flushEffects()

    expect(mocks.getWhoopStatus).toHaveBeenCalledOnce()
  })
})
