import { describe, expect, it, vi } from 'vitest'
import { getBootstrapEpoch, runSessionBootstrap } from '../sessionBootstrap'

function makeDeps(calls: string[], over: Record<string, unknown> = {}) {
  return {
    prepareLocalDataForUser: vi.fn(async () => { calls.push('boundary') }),
    hydrateRole: vi.fn(async () => { calls.push('role'); return 'athlete' as const }),
    pullMemberships: vi.fn(async () => { calls.push('memberships') }),
    backfillLegacyScope: vi.fn(async () => { calls.push('backfill') }),
    hydrateAthleteScope: vi.fn(async () => { calls.push('scope') }),
    runFullSync: vi.fn(async () => { calls.push('sync') }),
    ...over,
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('runSessionBootstrap', () => {
  it('ordena frontera, rol, scope y sync', async () => {
    const calls: string[] = []
    await runSessionBootstrap('u1', makeDeps(calls))
    expect(calls).toEqual(['boundary', 'role', 'memberships', 'backfill', 'scope', 'sync'])
  })

  // Cortar acá dejaba una sesión offline —o con un blip de Supabase— sin
  // memberships, sin scope y sobre todo SIN SYNC, de forma permanente hasta el
  // siguiente evento `online`/`focus`. `unknown` se trata como `athlete`, igual
  // que en `resolveAthleteScopeKind`: sólo un coach confirmado cambia el curso.
  it('con rol unknown continúa como athlete en vez de abortar el sync', async () => {
    const calls: string[] = []
    const deps = makeDeps(calls, {
      hydrateRole: vi.fn(async () => { calls.push('role'); return 'unknown' as const }),
    })
    await runSessionBootstrap('u1', deps)
    expect(calls).toEqual(['boundary', 'role', 'memberships', 'backfill', 'scope', 'sync'])
    expect(deps.runFullSync).toHaveBeenCalledTimes(1)
  })

  it('un coach no ejecuta backfill legacy', async () => {
    const calls: string[] = []
    const deps = makeDeps(calls, {
      hydrateRole: vi.fn(async () => { calls.push('role'); return 'coach' as const }),
    })
    await runSessionBootstrap('u1', deps)
    expect(calls).toEqual(['boundary', 'role', 'memberships', 'scope', 'sync'])
    expect(deps.backfillLegacyScope).not.toHaveBeenCalled()
  })

  it('serializa la frontera u1 → u2 y corta u1 después de la frontera', async () => {
    const events: string[] = []
    const firstStarted = deferred()
    const releaseFirst = deferred()
    const first = makeDeps([], {
      prepareLocalDataForUser: vi.fn(async () => {
        events.push('u1:start')
        firstStarted.resolve()
        await releaseFirst.promise
        events.push('u1:end')
      }),
    })
    const second = makeDeps([], {
      prepareLocalDataForUser: vi.fn(async () => { events.push('u2:start') }),
    })

    const p1 = runSessionBootstrap('u1', first)
    await firstStarted.promise
    const p2 = runSessionBootstrap('u2', second)
    await Promise.resolve()
    expect(events).toEqual(['u1:start'])

    releaseFirst.resolve()
    await Promise.all([p1, p2])

    expect(events).toEqual(['u1:start', 'u1:end', 'u2:start'])
    expect(first.hydrateRole).not.toHaveBeenCalled()
    expect(second.hydrateRole).toHaveBeenCalledTimes(1)
  })

  it('un bootstrap desplazado mientras espera no entra a la frontera', async () => {
    const firstStarted = deferred()
    const releaseFirst = deferred()
    const events: string[] = []
    const first = makeDeps([], {
      prepareLocalDataForUser: vi.fn(async () => {
        firstStarted.resolve()
        await releaseFirst.promise
      }),
    })
    const stale = makeDeps([], {
      prepareLocalDataForUser: vi.fn(async () => { events.push('stale') }),
    })
    const winner = makeDeps([], {
      prepareLocalDataForUser: vi.fn(async () => { events.push('winner') }),
    })

    const p1 = runSessionBootstrap('u1', first)
    await firstStarted.promise
    const p2 = runSessionBootstrap('u2', stale)
    const p3 = runSessionBootstrap('u3', winner)
    releaseFirst.resolve()
    await Promise.all([p1, p2, p3])

    expect(stale.prepareLocalDataForUser).not.toHaveBeenCalled()
    expect(events).toEqual(['winner'])
  })

  it('un fallo no rompe la cadena y el epoch avanza', async () => {
    const before = getBootstrapEpoch()
    const failing = makeDeps([], {
      prepareLocalDataForUser: vi.fn(async () => { throw new Error('boom') }),
    })
    await expect(runSessionBootstrap('u1', failing)).rejects.toThrow('boom')

    const after = makeDeps([])
    await runSessionBootstrap('u2', after)
    expect(after.runFullSync).toHaveBeenCalledTimes(1)
    expect(getBootstrapEpoch()).toBeGreaterThan(before)
  })
})
