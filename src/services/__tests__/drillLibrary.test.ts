import { describe, expect, it } from 'vitest'

import {
  findSquashDrillByName,
  resolveDrillExecutionMode,
  SQUASH_DRILL_LIBRARY,
} from '../training/drillLibrary'

describe('drillLibrary execution mode', () => {
  it('resolves every library drill to a supported execution mode', () => {
    const modes = new Set(['solo', 'partner', 'match'])

    for (const drill of SQUASH_DRILL_LIBRARY) {
      expect(modes.has(resolveDrillExecutionMode(drill))).toBe(true)
    }
  })

  it('cubre los tres modos declarables: solo, partner y match', () => {
    expect(resolveDrillExecutionMode(findSquashDrillByName('100 drops en solitario (50 por lado)')!)).toBe('solo')
    expect(resolveDrillExecutionMode(findSquashDrillByName('Juego condicionado solo paralelo')!)).toBe('partner')
    // Antes era `either`. Un drill que se alimenta desde media cancha necesita
    // otra persona, y `either` dejaba de decidirlo: ya no existe en el catálogo.
    expect(resolveDrillExecutionMode(findSquashDrillByName('Drops desde media cancha')!)).toBe('partner')
    expect(resolveDrillExecutionMode(findSquashDrillByName('Partido de entrenamiento al mejor de 3 juegos')!)).toBe('match')
  })
})
