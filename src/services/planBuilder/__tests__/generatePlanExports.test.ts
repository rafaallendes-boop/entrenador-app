import { describe, expect, it } from 'vitest'

describe('generatePlan exports', () => {
  it('exports generateSingleWeekWithRetry for the regenerate path', async () => {
    const mod = await import('../generatePlan')
    expect(typeof (mod as Record<string, unknown>).generateSingleWeekWithRetry).toBe('function')
  })
})
