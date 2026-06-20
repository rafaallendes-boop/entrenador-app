import { afterEach, describe, expect, it } from 'vitest'
import { isDevToolsEnabled } from '../devTools'

describe('isDevToolsEnabled', () => {
  const originalEnv = { ...import.meta.env }

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv)
  })

  it('is false in production regardless of flags', () => {
    Object.assign(import.meta.env, {
      PROD: true,
      VITE_DEV_TOOLS: 'true',
      VITE_SHOW_PLAN_QUALITY: 'true',
    })

    expect(isDevToolsEnabled()).toBe(false)
  })

  it('is false in dev when no flag is set', () => {
    Object.assign(import.meta.env, {
      PROD: false,
      VITE_DEV_TOOLS: undefined,
      VITE_SHOW_PLAN_QUALITY: undefined,
    })

    expect(isDevToolsEnabled()).toBe(false)
  })

  it('is true in dev when VITE_DEV_TOOLS=true', () => {
    Object.assign(import.meta.env, {
      PROD: false,
      VITE_DEV_TOOLS: 'true',
      VITE_SHOW_PLAN_QUALITY: undefined,
    })

    expect(isDevToolsEnabled()).toBe(true)
  })

  it('is true in dev when legacy VITE_SHOW_PLAN_QUALITY=true', () => {
    Object.assign(import.meta.env, {
      PROD: false,
      VITE_DEV_TOOLS: undefined,
      VITE_SHOW_PLAN_QUALITY: 'true',
    })

    expect(isDevToolsEnabled()).toBe(true)
  })
})
