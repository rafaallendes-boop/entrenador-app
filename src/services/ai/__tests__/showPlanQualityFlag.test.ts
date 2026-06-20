import { afterEach, describe, expect, it, vi } from 'vitest'

const importFresh = async () => {
  vi.resetModules()
  return await import('../showPlanQualityFlag')
}

describe('showPlanQualityFlag', () => {
  const originalEnv = { ...import.meta.env }

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv)
  })

  it('returns true when VITE_SHOW_PLAN_QUALITY is "true" and not PROD', async () => {
    Object.assign(import.meta.env, { VITE_DEV_TOOLS: undefined, VITE_SHOW_PLAN_QUALITY: 'true', PROD: false })
    const mod = await importFresh()
    expect(mod.shouldShowPlanQuality()).toBe(true)
  })

  it('returns false in PROD even if VITE_SHOW_PLAN_QUALITY is "true"', async () => {
    Object.assign(import.meta.env, { VITE_DEV_TOOLS: 'true', VITE_SHOW_PLAN_QUALITY: 'true', PROD: true })
    const mod = await importFresh()
    expect(mod.shouldShowPlanQuality()).toBe(false)
  })

  it('returns false when VITE_SHOW_PLAN_QUALITY is missing', async () => {
    Object.assign(import.meta.env, { VITE_DEV_TOOLS: undefined, VITE_SHOW_PLAN_QUALITY: undefined, PROD: false })
    const mod = await importFresh()
    expect(mod.shouldShowPlanQuality()).toBe(false)
  })

  it('returns false for non-"true" values', async () => {
    for (const value of ['1', 'yes', 'TRUE', 'false', '']) {
      Object.assign(import.meta.env, { VITE_DEV_TOOLS: undefined, VITE_SHOW_PLAN_QUALITY: value, PROD: false })
      const mod = await importFresh()
      expect(mod.shouldShowPlanQuality()).toBe(false)
    }
  })
})
