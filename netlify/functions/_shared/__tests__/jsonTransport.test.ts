import { describe, expect, it } from 'vitest'

import { stringifyJsonForTransport } from '../jsonTransport'

describe('stringifyJsonForTransport', () => {
  it('preserva texto Unicode usando un body compuesto sólo por ASCII', () => {
    const value = {
      body: 'Llevas 17 días sin check-in. ¿Hay algún problema? 🚀',
      separator: '\u2028',
    }

    const serialized = stringifyJsonForTransport(value)

    expect([...serialized].every((character) => character.charCodeAt(0) < 128)).toBe(true)
    expect(JSON.parse(serialized)).toEqual(value)
    expect(serialized).toContain('d\\u00edas')
    expect(serialized).toContain('alg\\u00fan')
  })

  it('sigue aplicando el escaping JSON normal a controles, comillas y barras', () => {
    const value = { body: 'línea 1\n"línea 2" \\' }

    expect(JSON.parse(stringifyJsonForTransport(value))).toEqual(value)
  })
})

