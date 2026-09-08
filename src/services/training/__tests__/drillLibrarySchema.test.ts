import { describe, expect, it } from 'vitest'

import { findSquashDrillByName, SQUASH_DRILL_LIBRARY, toSquashDrill } from '../drillLibrary'

describe('SquashDrillDefinition schema Fase 2', () => {
  it('every drill declares phaseAppropriate as a non-empty valid subset', () => {
    const validPhases = new Set(['base', 'build', 'peak', 'taper', 'transition', 'race'])

    for (const drill of SQUASH_DRILL_LIBRARY) {
      expect(drill.phaseAppropriate, `drill ${drill.id}`).toBeDefined()
      expect(drill.phaseAppropriate?.length).toBeGreaterThan(0)
      for (const phase of drill.phaseAppropriate ?? []) {
        expect(validPhases.has(phase)).toBe(true)
      }
    }
  })

  it('every drill declares partnerRequired', () => {
    for (const drill of SQUASH_DRILL_LIBRARY) {
      expect(typeof drill.partnerRequired).toBe('boolean')
    }
  })

  it('does not retain the removed early-attack match drill or its alias', () => {
    expect(SQUASH_DRILL_LIBRARY.some((drill) => drill.id === 'practice_match_short_points_attack')).toBe(false)
    expect(findSquashDrillByName('Partido con ataque temprano')).toBeUndefined()
    expect(findSquashDrillByName('Partido con foco de ataque en puntos cortos')).toBeUndefined()
  })

  it('match drills are not phaseAppropriate for base phase', () => {
    const matchDrills = SQUASH_DRILL_LIBRARY.filter((drill) =>
      drill.category === 'match' || drill.tags.includes('match_play')
    )

    for (const drill of matchDrills) {
      expect(drill.phaseAppropriate).not.toContain('base')
    }
  })

  it('solo drills do not require a partner; reactive partner cues are explicit', () => {
    const soloDrills = SQUASH_DRILL_LIBRARY.filter((drill) =>
      drill.executionMode === 'solo'
    )

    for (const drill of soloDrills) {
      expect(drill.partnerRequired).toBe(false)
    }
  })

  it('every drill exposes player-facing notes with objective and execution cue', () => {
    for (const definition of SQUASH_DRILL_LIBRARY) {
      expect(definition.description.length, `drill ${definition.id}`).toBeGreaterThan(120)
      expect(definition.description, `drill ${definition.id}`).toContain('Objetivo:')
      expect(definition.description, `drill ${definition.id}`).toContain('Clave:')

      const drill = toSquashDrill(definition)
      expect(drill.notes, `drill ${definition.id}`).toBe(definition.description)
    }
  })
})
