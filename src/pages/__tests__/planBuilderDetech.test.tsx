import { afterEach, describe, expect, it } from 'vitest'
import { isDevToolsEnabled } from '../../services/devTools'

describe('isDevToolsEnabled gating (Plan Builder)', () => {
  const originalEnv = { ...import.meta.env }

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv)
  })

  it('is off in prod so quality debug stays hidden', () => {
    Object.assign(import.meta.env, { PROD: true, VITE_DEV_TOOLS: 'true' })

    expect(isDevToolsEnabled()).toBe(false)
  })
})
