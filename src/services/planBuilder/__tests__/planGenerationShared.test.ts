import { afterEach, describe, expect, it } from 'vitest'
import {
  isGeneratePlanPayload,
  MAX_WEEKS,
  resolveSelfBaseUrl,
} from '../../../../netlify/functions/_shared/planGenerationShared'

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

describe('resolveSelfBaseUrl', () => {
  const originalUrl = process.env.URL

  afterEach(() => {
    if (originalUrl == null) {
      delete process.env.URL
    } else {
      process.env.URL = originalUrl
    }
  })

  it('prefers the inbound request host over the production URL env var', () => {
    process.env.URL = 'https://prod.example.com'

    expect(resolveSelfBaseUrl({
      headers: {
        host: 'deploy-preview-7--app.netlify.app',
        'x-forwarded-proto': 'https',
      },
    } as never)).toBe('https://deploy-preview-7--app.netlify.app')
  })

  it('falls back to URL when host headers are missing', () => {
    process.env.URL = 'https://prod.example.com/'

    expect(resolveSelfBaseUrl({ headers: {} } as never)).toBe('https://prod.example.com')
  })
})
