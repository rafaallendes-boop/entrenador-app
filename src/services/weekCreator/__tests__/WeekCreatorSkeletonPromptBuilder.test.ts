import { describe, expect, it } from 'vitest'

import {
  buildWeekCreatorSkeletonPrompt,
  buildWeekCreatorSkeletonSystemPrompt,
} from '../WeekCreatorSkeletonPromptBuilder'

describe('WeekCreatorSkeletonPromptBuilder', () => {
  it('keeps the existing context prompt intact and replaces only the contract prompt', () => {
    const userPrompt = 'Solicitud del usuario: crea ocho sesiones\n## PERFIL DEL ATLETA\n- Fatiga: normal'
    const result = buildWeekCreatorSkeletonPrompt({ userPrompt })

    expect(result.userPrompt).toBe(userPrompt)
    expect(result.systemPrompt).toBe(buildWeekCreatorSkeletonSystemPrompt())
  })

  it('asks only for a compact, locally-hydratable skeleton', () => {
    const prompt = buildWeekCreatorSkeletonSystemPrompt()

    expect(prompt).toContain('esqueletos semanales')
    expect(prompt).toContain('focusKey')
    expect(prompt).toContain('subtype o runningType sólo cuando correspondan')
    expect(prompt).toContain('la app los hidrata y valida localmente')
    expect(prompt).not.toContain('squashDetails')
    expect(prompt).not.toContain('cyclingDetails')
    expect(prompt).not.toContain('mobilityDetails')
    expect(prompt.length).toBeLessThan(1_100)
  })
})
