import { describe, expect, it } from 'vitest'

import { ROUTES } from '../../constants/routes'
import { resolveGeneratedWeeksRoute } from '../planDashboardNavigation'

describe('resolveGeneratedWeeksRoute', () => {
  it('opens the weekly planner when the generated plan is already active', () => {
    expect(resolveGeneratedWeeksRoute({ status: 'active' })).toBe(ROUTES.WEEK)
  })

  it('keeps the builder route while there is no active generated plan', () => {
    expect(resolveGeneratedWeeksRoute(null)).toBe(ROUTES.PLAN_BUILDER_V2)
    expect(resolveGeneratedWeeksRoute({ status: 'draft' })).toBe(ROUTES.PLAN_BUILDER_V2)
  })
})
