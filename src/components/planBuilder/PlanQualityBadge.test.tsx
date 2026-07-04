import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlanQualityBadge } from './PlanQualityBadge'
import type { PlanQualityReview } from '../../services/planBuilder/qualityReview'

const review: PlanQualityReview = {
  score: 81,
  grade: 'good',
  issues: [],
  weeks: [
    { weekIndex: 0, weekStartDate: '2026-06-01', score: 90, grade: 'excellent', issues: [], repairCount: 0 },
    {
      weekIndex: 1,
      weekStartDate: '2026-06-08',
      score: 72,
      grade: 'needs_review',
      issues: [{ severity: 'warning', code: 'demo', message: 'demo issue' }],
      repairCount: 1,
    },
  ],
  repairCount: 1,
  criticalIssueCount: 0,
  warningCount: 1,
}

describe('PlanQualityBadge', () => {
  const originalEnv = { ...import.meta.env }

  beforeEach(() => {
    Object.assign(import.meta.env, { VITE_SHOW_PLAN_QUALITY: 'true', PROD: false })
  })

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv)
  })

  it('renders global grade when flag is on', () => {
    const html = renderToStaticMarkup(<PlanQualityBadge review={review} />)

    expect(html).toContain('Bueno')
    expect(html).toContain('Puntaje 81')
  })

  it('renders nothing when flag is off', () => {
    Object.assign(import.meta.env, { VITE_SHOW_PLAN_QUALITY: undefined })

    const html = renderToStaticMarkup(<PlanQualityBadge review={review} />)

    expect(html).toBe('')
  })

  it('includes per-week scores in details', () => {
    const html = renderToStaticMarkup(<PlanQualityBadge review={review} />)

    expect(html).toContain('Semana 1')
    expect(html).toContain('Semana 2')
    expect(html).toContain('Requiere revisión del coach')
    expect(html).not.toContain('needs_review')
  })
})
