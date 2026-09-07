import { describe, expect, it } from 'vitest'
import {
  MOBILITY_SESSION_LIBRARY,
  selectMobilitySessionForContext,
} from '../mobilitySessionLibrary'

describe('selectMobilitySessionForContext', () => {
  it('devuelve una sesión apta para el deporte pedido', () => {
    const elegida = selectMobilitySessionForContext({ sport: 'squash' })
    expect(elegida.suitableSportContext).toContain('squash')
  })

  it('prefiere una sesión del foco pedido cuando existe', () => {
    const elegida = selectMobilitySessionForContext({ sport: 'running', focus: ['ankle_foot'] })
    expect(elegida.focus).toContain('ankle_foot')
  })

  // Determinista: el mismo pedido devuelve siempre la misma sesión, para que
  // dos usuarios con el mismo contexto no reciban propuestas distintas por azar.
  it('es determinista', () => {
    const a = selectMobilitySessionForContext({ sport: 'squash', focus: ['hip'] })
    const b = selectMobilitySessionForContext({ sport: 'squash', focus: ['hip'] })
    expect(a.id).toBe(b.id)
  })

  it('cae en una sesión general si el foco pedido no existe para ese deporte', () => {
    const elegida = selectMobilitySessionForContext({ sport: 'cycling', focus: ['activation'] })
    expect(elegida).toBeDefined()
    expect(elegida.suitableSportContext).toContain('cycling')
  })

  it('siempre devuelve una sesión con estructura real, nunca vacía', () => {
    for (const sport of ['squash', 'running', 'cycling', 'strength', 'general'] as const) {
      const elegida = selectMobilitySessionForContext({ sport })
      expect(elegida.typicalStructure.trim().length).toBeGreaterThan(20)
    }
  })

  it('todas las sesiones de la librería tienen estructura', () => {
    for (const sesion of MOBILITY_SESSION_LIBRARY) {
      expect(sesion.typicalStructure.trim()).not.toBe('')
    }
  })
})
