import { describe, expect, it } from 'vitest'

import { findSquashDrillByName } from '../drillLibrary'
import { selectSquashDrills } from '../drillSelector'

describe('selectSquashDrills Fase 2 phase/partner filters', () => {
  it('does not select match drills in base phase', () => {
    const selection = selectSquashDrills({
      phase: 'base',
      fatigueLevel: 3,
      recentDrills: [],
      goal: 'construir base tecnica',
      competitionSoon: false,
      partnerAvailability: 'partner',
      desiredKind: 'match',
    })

    const definitions = selection.drills.map((drill) => findSquashDrillByName(drill.name))
    expect(definitions.every((drill) => drill?.category !== 'match')).toBe(true)
  })

  it('excludes partner-required drills when partnerAvailability is solo', () => {
    const selection = selectSquashDrills({
      phase: 'build',
      fatigueLevel: 3,
      recentDrills: [],
      goal: 'entrenar solo con control tecnico',
      competitionSoon: false,
      partnerAvailability: 'solo',
      desiredKind: 'mixed-shadows-control',
    })

    const definitions = selection.drills.map((drill) => findSquashDrillByName(drill.name))
    expect(definitions.every((drill) => drill?.partnerRequired === false)).toBe(true)
  })
})
