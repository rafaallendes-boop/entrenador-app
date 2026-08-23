// @vitest-environment jsdom

import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import RouteRobotsMeta from './RouteRobotsMeta'

function robotsContent(): string | null {
  return document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null
}

/**
 * `MemoryRouter`'s `initialEntries` only seeds history on first mount — it is
 * not reactive, so re-rendering a `MemoryRouter` with a different prop does
 * NOT simulate client-side navigation. This drives an actual `navigate()`
 * call on the same, already-mounted router history, which is what the
 * "navigation between routes" test needs to be a real test of the effect's
 * `location.pathname` dependency instead of just a remount.
 */
function NavigateTo({ path }: { path: string }) {
  const navigate = useNavigate()
  useEffect(() => {
    navigate(path)
  }, [navigate, path])
  return null
}

describe('RouteRobotsMeta', () => {
  afterEach(() => {
    cleanup()
    document.head.querySelectorAll('meta[name="robots"]').forEach((el) => el.remove())
  })

  it('marks a known public route as indexable', () => {
    render(
      <MemoryRouter initialEntries={['/pricing']}>
        <RouteRobotsMeta />
      </MemoryRouter>,
    )

    expect(robotsContent()).toBe('index, follow')
  })

  it('marks a private app route as noindex', () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <RouteRobotsMeta />
      </MemoryRouter>,
    )

    expect(robotsContent()).toBe('noindex, nofollow')
  })

  it('marks an unknown/legacy alias route as noindex — the exact gap the whitelist rewrite of robots.txt closed', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <RouteRobotsMeta />
      </MemoryRouter>,
    )

    expect(robotsContent()).toBe('noindex, nofollow')
  })

  it('re-evaluates on client-side navigation between a public and a private route', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/pricing']}>
        <RouteRobotsMeta />
        <NavigateTo path="/pricing" />
      </MemoryRouter>,
    )
    expect(robotsContent()).toBe('index, follow')

    act(() => {
      rerender(
        <MemoryRouter initialEntries={['/pricing']}>
          <RouteRobotsMeta />
          <NavigateTo path="/chat" />
        </MemoryRouter>,
      )
    })
    expect(robotsContent()).toBe('noindex, nofollow')
  })

  it('reuses a single meta tag instead of appending duplicates', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouteRobotsMeta />
      </MemoryRouter>,
    )

    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1)
  })
})
