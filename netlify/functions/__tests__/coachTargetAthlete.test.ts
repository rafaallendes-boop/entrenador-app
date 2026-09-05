import { describe, expect, it, vi } from 'vitest'

// `coach.ts` llama `stream(...)` al evaluarse; sin este mock se ejerce el
// wrapper de AWS. Se registra acá (y no vía `helpers/coachTestHarness`) porque
// este archivo sólo necesita el validador puro, no el handler completo.
vi.mock('@netlify/functions', () => ({
  stream: <T>(handler: T) => handler,
}))

import { validateCoachRequestForTest } from '../coach'

function payload(over: Record<string, unknown> = {}) {
  return {
    systemPrompt: 'sys',
    userMessage: 'hola',
    requestClass: 'chat_action',
    traceId: 't-1',
    ...over,
  }
}

describe('targetAthleteId en el payload', () => {
  it('ausente es válido y queda null', () => {
    const result = validateCoachRequestForTest(payload())
    expect(result.ok).toBe(true)
    expect(result.req?.targetAthleteId).toBeNull()
  })

  it('una cadena razonable se conserva', () => {
    const result = validateCoachRequestForTest(payload({ targetAthleteId: 'ath_m_abc' }))
    expect(result.ok).toBe(true)
    expect(result.req?.targetAthleteId).toBe('ath_m_abc')
  })

  it('rechaza tipos que no sean cadena', () => {
    for (const value of [1, {}, [], true]) {
      expect(validateCoachRequestForTest(payload({ targetAthleteId: value })).ok).toBe(false)
    }
  })

  it('rechaza cadena vacía y cadenas absurdamente largas', () => {
    expect(validateCoachRequestForTest(payload({ targetAthleteId: '' })).ok).toBe(false)
    expect(validateCoachRequestForTest(payload({ targetAthleteId: 'a'.repeat(200) })).ok).toBe(false)
  })

  it('un null explícito es válido y no propone objetivo', () => {
    const result = validateCoachRequestForTest(payload({ targetAthleteId: null }))
    expect(result.ok).toBe(true)
    expect(result.req?.targetAthleteId).toBeNull()
  })
})
