import { describe, expect, it } from 'vitest'

import type { SquashSessionBlockKind } from '../../../types'
import { findSquashDrillByName, resolveDrillExecutionMode, resolveSquashDrillKind } from '../drillLibrary'
import { hydrateSquashSession, type SquashHydrationInput } from '../squashSessionHydrator'

function input(overrides: Partial<SquashHydrationInput> = {}): SquashHydrationInput {
  return {
    kind: 'technical',
    durationMin: 60,
    phase: 'build',
    fatigueLevel: 4,
    goal: 'sostener largo y precisión',
    recentDrills: [],
    competitionSoon: false,
    ...overrides,
  }
}

function modesOf(result: ReturnType<typeof hydrateSquashSession>): string[] {
  return result.details.drills.map((drill) => {
    const definition = findSquashDrillByName(drill.name)
    return definition ? resolveDrillExecutionMode(definition) : 'unknown'
  })
}

function kindsOf(result: ReturnType<typeof hydrateSquashSession>): SquashSessionBlockKind[] {
  return result.details.drills.map((drill) => {
    const definition = findSquashDrillByName(drill.name)
    return definition ? resolveSquashDrillKind(definition) : 'technical'
  })
}

describe('hydrateSquashSession — la modalidad declarada manda', () => {
  it('control produce sólo trabajo en solitario', () => {
    const result = hydrateSquashSession(input({ kind: 'control' }))

    expect(result.details.sessionKind).toBe('control')
    expect(result.subtype).toBe('control')
    expect(kindsOf(result).every((kind) => kind === 'control')).toBe(true)
    expect(modesOf(result).every((mode) => mode === 'solo')).toBe(true)
  })

  it('technical produce sólo trabajo con partner', () => {
    const result = hydrateSquashSession(input({ kind: 'technical' }))

    expect(result.details.sessionKind).toBe('technical')
    expect(result.subtype).toBe('training')
    expect(kindsOf(result).every((kind) => kind === 'technical')).toBe(true)
    expect(modesOf(result).every((mode) => mode === 'partner')).toBe(true)
  })

  it('shadows produce sólo movimiento sin pelota', () => {
    const result = hydrateSquashSession(input({ kind: 'shadows' }))

    expect(result.details.sessionKind).toBe('shadows')
    expect(kindsOf(result).every((kind) => kind === 'shadows')).toBe(true)
  })

  it('el objetivo no puede cambiar la modalidad', () => {
    const conControl = hydrateSquashSession(input({
      kind: 'technical',
      goal: 'control de longitud y precisión bajo presión',
    }))
    const neutro = hydrateSquashSession(input({ kind: 'technical', goal: 'trabajo de cancha' }))

    expect(conControl.details.sessionKind).toBe('technical')
    expect(neutro.details.sessionKind).toBe('technical')
    expect(modesOf(conControl)).not.toContain('solo')
  })
})

describe('hydrateSquashSession — accesorio de sombras', () => {
  it('sombras complementan control sin cambiar la modalidad principal', () => {
    const result = hydrateSquashSession(input({ kind: 'control', withShadowsAccessory: true }))

    expect(result.details.sessionKind).toBe('control')
    expect(new Set(kindsOf(result))).toEqual(new Set(['control', 'shadows']))
    // Sigue siendo ejecutable en solitario de punta a punta.
    expect(modesOf(result).every((mode) => mode === 'solo')).toBe(true)
  })

  it('sombras complementan técnico sin volverlo solitario', () => {
    const result = hydrateSquashSession(input({ kind: 'technical', withShadowsAccessory: true }))

    expect(result.details.sessionKind).toBe('technical')
    expect(kindsOf(result)).toContain('technical')
    expect(kindsOf(result)).toContain('shadows')
  })

  it('una sesión de sombras no admite accesorio de sombras', () => {
    const result = hydrateSquashSession(input({ kind: 'shadows', withShadowsAccessory: true }))

    expect(kindsOf(result).every((kind) => kind === 'shadows')).toBe(true)
  })

  it('taper conserva sombras de movimiento corto como complemento', () => {
    // A1 habilitó en taper sólo las tres de movimiento corto; el acondicionamiento
    // aeróbico queda fuera. La víspera admite complemento, no volumen.
    const result = hydrateSquashSession(input({ kind: 'control', phase: 'taper', withShadowsAccessory: true }))

    expect(kindsOf(result)).toContain('shadows')
    expect(result.warnings.map((warning) => warning.code)).not.toContain('shadows_accessory_unavailable')
    expect(modesOf(result).every((mode) => mode === 'solo')).toBe(true)
  })
})

describe('hydrateSquashSession — nunca cruza de modalidad', () => {
  it('un pool corto avisa en vez de completar con otra modalidad', () => {
    // Taper reduce el pool y sube el mínimo con 90 min.
    const result = hydrateSquashSession(input({ kind: 'control', phase: 'taper', durationMin: 90 }))

    expect(kindsOf(result).every((kind) => kind === 'control')).toBe(true)
    expect(modesOf(result)).not.toContain('partner')
  })

  it('reutiliza modalidad antes que mezclar cuando todo está reciente', () => {
    const allControlNames = ['Drops en solitario — 100 (50 por lado)', 'Drives desde media cancha — 100',
      'Drives al cuadro de saque — 100', 'Drives paralelos desde el fondo — 100', 'Voleas en solitario',
      'Paralelas de revés — 100', 'Paralelas de derecha — 100', 'Paralela de fondo y cruzada — 100 ciclos',
      'Volea paralela y volea cruzada — 100', 'Boast y paralela en solitario — 50 ciclos',
      '3 paralelas de fondo + kill paralelo — 25 ciclos']

    const result = hydrateSquashSession(input({ kind: 'control', recentDrills: allControlNames }))

    expect(result.details.drills.length).toBeGreaterThan(0)
    expect(modesOf(result).every((mode) => mode === 'solo')).toBe(true)
  })

  it('un partido sin partner se redirige a control y lo declara', () => {
    const result = hydrateSquashSession(input({ kind: 'match', partnerAvailability: 'solo' }))

    expect(result.details.sessionKind).toBe('control')
    expect(result.fallback).toMatchObject({ requestedKind: 'match', resolvedKind: 'control' })
    expect(result.warnings.map((warning) => warning.code)).toContain('match_requires_partner')
    expect(modesOf(result).every((mode) => mode === 'solo')).toBe(true)
  })
})

describe('hydrateSquashSession — proyección de subtype y modo', () => {
  it('un partido de competencia se distingue de uno de entrenamiento', () => {
    const practice = hydrateSquashSession(input({ kind: 'match', phase: 'peak' }))
    const competitive = hydrateSquashSession(input({ kind: 'match', phase: 'peak', competitive: true }))

    expect(practice.subtype).toBe('match')
    expect(practice.details.sessionMode).toBe('practice_match')
    expect(competitive.subtype).toBe('competitive')
    expect(competitive.details.sessionMode).toBe('competition_match')
  })

  it('toda sesión que no es partido queda como drill_session', () => {
    for (const kind of ['control', 'technical', 'shadows'] as SquashSessionBlockKind[]) {
      expect(hydrateSquashSession(input({ kind })).details.sessionMode).toBe('drill_session')
    }
  })

  it('blocks y drills se mantienen consistentes', () => {
    const result = hydrateSquashSession(input({ kind: 'control', withShadowsAccessory: true }))
    const flattened = (result.details.blocks ?? []).flatMap((block) => block.drills)

    expect(flattened.map((drill) => drill.name)).toEqual(result.details.drills.map((drill) => drill.name))
  })
})
