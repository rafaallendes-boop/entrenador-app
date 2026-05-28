import { describe, expect, it } from 'vitest'

import { selectStrengthBlockTemplate, STRENGTH_BLOCK_TEMPLATES } from '../strengthBlocks'

describe('strengthBlocks', () => {
  it('exposes templates for build/peak/taper/race', () => {
    const phases = new Set(STRENGTH_BLOCK_TEMPLATES.map((template) => template.phase))

    expect(phases.has('build')).toBe(true)
    expect(phases.has('peak')).toBe(true)
    expect(phases.has('taper')).toBe(true)
    expect(phases.has('race')).toBe(true)
  })

  it('build phase has 3 sub-templates A/B/C', () => {
    const buildSubs = STRENGTH_BLOCK_TEMPLATES
      .filter((template) => template.phase === 'build')
      .map((template) => template.subTemplate)
      .sort()

    expect(buildSubs).toEqual(['A', 'B', 'C'])
  })

  it('selectStrengthBlockTemplate rotates by weekIndexInBlock', () => {
    expect(selectStrengthBlockTemplate('build', 0).subTemplate).toBe('A')
    expect(selectStrengthBlockTemplate('build', 1).subTemplate).toBe('B')
    expect(selectStrengthBlockTemplate('build', 2).subTemplate).toBe('C')
    expect(selectStrengthBlockTemplate('build', 3).subTemplate).toBe('A')
  })

  it('build A template has a squat star-lift candidate', () => {
    const template = selectStrengthBlockTemplate('build', 0)

    expect(template.slots.some((slot) => slot.isStarLiftCandidate && slot.pattern === 'squat')).toBe(true)
  })

  it('taper templates have fewer slots than build', () => {
    expect(selectStrengthBlockTemplate('taper', 0).slots.length).toBeLessThan(selectStrengthBlockTemplate('build', 0).slots.length)
  })

  it('race template does not require heavy patterns', () => {
    const race = selectStrengthBlockTemplate('race', 0)
    const heavy = race.slots.filter((slot) =>
      slot.pattern === 'squat' || slot.pattern === 'hinge' || slot.pattern === 'push' || slot.pattern === 'pull'
    )

    expect(heavy.every((slot) => !slot.required)).toBe(true)
  })
})
