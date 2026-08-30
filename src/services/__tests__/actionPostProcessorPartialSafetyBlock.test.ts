import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'

describe('bloqueo parcial de seguridad', () => {
  // Cuando una acción de fuerza se bloquea pero otras sobreviven, mostrar
  // SÓLO el copy de bloqueo contradice la tarjeta de propuesta que igual se
  // renderiza. El copy debe sumarse al mensaje, no reemplazarlo.
  it('el copy de bloqueo no reemplaza el mensaje cuando sobreviven acciones', () => {
    const source = readFileSync('src/services/ai/actionPostProcessor.ts', 'utf8')
    expect(source).toContain('const fullyBlocked =')
    expect(source).toMatch(/fullyBlocked\s*\n?\s*\?\s*BLOCKED_STRENGTH_COPY/)
  })

  // Y el caso parcial tiene que ser contable en /ops sin mentir sobre el
  // outcome: sí hubo propuesta, así que no es `safe_decline`.
  it('el caso parcial emite un warning propio, distinto del bloqueo total', () => {
    const source = readFileSync('src/services/ai/actionPostProcessor.ts', 'utf8')
    expect(source).toContain('chat_action_strength_safety_partially_blocked')
    expect(source).toContain('chat_action_strength_safety_blocked')
  })
})
