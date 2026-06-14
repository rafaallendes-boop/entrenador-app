import { describe, expect, it } from 'vitest'
import { isGeneratePlanPayload, MAX_WEEKS } from '../../../../netlify/functions/_shared/planGenerationShared'

function validPayload(weekCount = 1) {
  return {
    plan: { id: 'plan-1' },
    weeks: Array.from({ length: weekCount }, (_, i) => ({ id: `w${i}`, planId: 'plan-1', weekIndex: i })),
    profile: { id: 'a1' },
    wizardConfig: {},
  }
}

describe('isGeneratePlanPayload', () => {
  it('accepts a well-formed payload', () => {
    expect(isGeneratePlanPayload(validPayload())).toBe(true)
  })

  it('rejects non-objects and missing plan id', () => {
    expect(isGeneratePlanPayload(null)).toBe(false)
    expect(isGeneratePlanPayload('nope')).toBe(false)
    expect(isGeneratePlanPayload({ ...validPayload(), plan: {} })).toBe(false)
  })

  it('rejects empty or oversized week arrays', () => {
    expect(isGeneratePlanPayload({ ...validPayload(), weeks: [] })).toBe(false)
    expect(isGeneratePlanPayload(validPayload(MAX_WEEKS + 1))).toBe(false)
    expect(isGeneratePlanPayload(validPayload(MAX_WEEKS))).toBe(true)
  })

  it('rejects weeks that belong to a different plan', () => {
    const payload = validPayload()
    payload.weeks[0].planId = 'other-plan'
    expect(isGeneratePlanPayload(payload)).toBe(false)
  })
})
