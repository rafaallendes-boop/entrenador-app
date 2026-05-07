import { describe, expect, it } from 'vitest'

import { normalizeCoachMarkdown } from './markdown'

describe('normalizeCoachMarkdown', () => {
  it('moves trailing colons outside italic markers', () => {
    expect(normalizeCoachMarkdown('*Esta semana:*')).toBe('*Esta semana*:')
    expect(normalizeCoachMarkdown('*Salud y prevencion de lesion:*')).toBe('*Salud y prevencion de lesion*:')
  })

  it('removes dangling emphasis markers from bullet headings', () => {
    expect(normalizeCoachMarkdown('* Esta semana:*')).toBe('* Esta semana:')
    expect(normalizeCoachMarkdown('- Rendimiento en squash:*')).toBe('- Rendimiento en squash:')
  })
})
