import { describe, expect, it } from 'vitest'

import {
  createRepairTaxonomyMeta,
  recordRepairAction,
  summarizeTaxonomy,
} from '../repairTaxonomy'

describe('repairTaxonomy', () => {
  it('starts every counter at zero', () => {
    const summary = summarizeTaxonomy(createRepairTaxonomyMeta())
    expect(summary).toEqual({
      hydrationActionCount: 0,
      correctiveActionCount: 0,
      structuralActionCount: 0,
      hydratedSessionsAffected: 0,
      correctedSessionsAffected: 0,
      structurallyRepairedSessionsAffected: 0,
    })
  })

  it('counts actions, not sessions, when the same session is touched twice', () => {
    const taxonomy = createRepairTaxonomyMeta()
    recordRepairAction(taxonomy, 'corrective', '2026-08-03|AM')
    recordRepairAction(taxonomy, 'corrective', '2026-08-03|AM')

    const summary = summarizeTaxonomy(taxonomy)
    expect(summary.correctiveActionCount).toBe(2)
    expect(summary.correctedSessionsAffected).toBe(1)
  })

  it('keeps categories independent', () => {
    const taxonomy = createRepairTaxonomyMeta()
    recordRepairAction(taxonomy, 'hydration', 'a')
    recordRepairAction(taxonomy, 'structural', 'b')

    const summary = summarizeTaxonomy(taxonomy)
    expect(summary.hydrationActionCount).toBe(1)
    expect(summary.structuralActionCount).toBe(1)
    expect(summary.correctiveActionCount).toBe(0)
  })

  it('tracks an action without inventing a unique session when no key is supplied', () => {
    const taxonomy = createRepairTaxonomyMeta()
    recordRepairAction(taxonomy, 'hydration')
    const summary = summarizeTaxonomy(taxonomy)
    expect(summary.hydrationActionCount).toBe(1)
    expect(summary.hydratedSessionsAffected).toBe(0)
  })
})
