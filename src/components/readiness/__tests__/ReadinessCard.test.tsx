import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReadinessCard } from '../ReadinessCard'
import type { ReadinessDaily } from '../../../types'

const readiness: ReadinessDaily = {
  id: 'whoop:ath_u1:2026-06-21',
  athleteId: 'ath_u1',
  date: '2026-06-21',
  recoveryScore: 28,
  sleepHours: 5.2,
  sleepPerformance: 61,
  strain: 14.1,
  source: 'whoop',
  updatedAt: 1,
}

describe('ReadinessCard', () => {
  it('renders recovery, sleep and strain when present', () => {
    const html = renderToStaticMarkup(<ReadinessCard readiness={readiness} connected />)
    expect(html).toContain('28')
    expect(html).toContain('5.2')
    expect(html).toContain('14.1')
  })

  it('shows a connect CTA when not connected', () => {
    const html = renderToStaticMarkup(<ReadinessCard connected={false} canConnect />)
    expect(html.toLowerCase()).toContain('whoop')
    expect(html.toLowerCase()).toContain('conect')
  })

  it('does not show a connect CTA for a non-self athlete', () => {
    const html = renderToStaticMarkup(<ReadinessCard connected={false} canConnect={false} />)
    expect(html.toLowerCase()).toContain('sin datos')
    expect(html.toLowerCase()).not.toContain('conectar whoop')
  })

  it('shows a no-data state when connected but no readiness today', () => {
    const html = renderToStaticMarkup(<ReadinessCard connected />)
    expect(html.toLowerCase()).toContain('sin datos')
  })

  it('shows a no-data state for all-null readiness rows', () => {
    const html = renderToStaticMarkup(
      <ReadinessCard
        connected
        readiness={{
          id: 'whoop:ath_u1:2026-06-21',
          athleteId: 'ath_u1',
          date: '2026-06-21',
          source: 'whoop',
          updatedAt: 1,
        }}
      />,
    )

    expect(html.toLowerCase()).toContain('sin datos')
    expect(html).not.toContain('Sin score')
  })
})
