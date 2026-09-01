import { describe, expect, it } from 'vitest'
import {
  isClassAllowed,
  isTier,
  minTierForClass,
  resolveTier,
  REQUEST_CLASS_MIN_TIER,
  TIER_ORDER,
  type Tier,
} from '../entitlementPolicy'
import type { AIRequestClass } from '../../../types'
import { ALL_AI_REQUEST_CLASSES } from '../../ai/aiRequestClasses'

const NOW = Date.parse('2026-08-15T12:00:00Z')
const ALL_TIERS: Tier[] = ['free', 'weekly', 'advanced']

const ALL_CLASSES = Object.keys(ALL_AI_REQUEST_CLASSES) as AIRequestClass[]

describe('resolveTier', () => {
  it('sin fila resuelve free', () => {
    expect(resolveTier(null, NOW)).toBe('free')
    expect(resolveTier(undefined, NOW)).toBe('free')
  })

  it('fila sin vencimiento conserva su tier', () => {
    expect(resolveTier({ tier: 'advanced', expiresAt: null }, NOW)).toBe('advanced')
  })

  it('fila vigente conserva su tier', () => {
    expect(resolveTier({ tier: 'weekly', expiresAt: NOW + 1000 }, NOW)).toBe('weekly')
  })

  it('fila vencida resuelve free', () => {
    expect(resolveTier({ tier: 'advanced', expiresAt: NOW - 1 }, NOW)).toBe('free')
  })

  it('vencimiento exactamente ahora ya no es vigente', () => {
    expect(resolveTier({ tier: 'advanced', expiresAt: NOW }, NOW)).toBe('free')
  })
})

describe('isClassAllowed — matriz completa 3 tiers x 8 clases', () => {
  // Expectativa declarada a mano, NO derivada del mapa: si se deriva, el test
  // no puede detectar que el mapa cambió.
  const EXPECTED: Record<AIRequestClass, Record<Tier, boolean>> = {
    chat_general:      { free: true,  weekly: true, advanced: true },
    chat_action:       { free: true,  weekly: true, advanced: true },
    import_extract:    { free: true,  weekly: true, advanced: true },
    weekly_summary:    { free: false, weekly: true, advanced: true },
    week_creator:      { free: false, weekly: false, advanced: true },
    plan_builder_week: { free: false, weekly: false, advanced: true },
    plan_builder_pair: { free: false, weekly: false, advanced: true },
    coach_assistant_message: { free: false, weekly: false, advanced: true },
  }

  for (const requestClass of ALL_CLASSES) {
    for (const tier of ALL_TIERS) {
      it(`${tier} → ${requestClass} = ${EXPECTED[requestClass][tier]}`, () => {
        expect(isClassAllowed(tier, requestClass)).toBe(EXPECTED[requestClass][tier])
      })
    }
  }
})

describe('clase desconocida', () => {
  it('se deniega para todo tier, incluido advanced', () => {
    for (const tier of ALL_TIERS) {
      expect(isClassAllowed(tier, 'clase_inventada')).toBe(false)
    }
  })

  it('minTierForClass devuelve null para una clase desconocida', () => {
    expect(minTierForClass('clase_inventada')).toBeNull()
  })
})

describe('guard de drift', () => {
  it('toda AIRequestClass tiene entrada en el mapa', () => {
    for (const requestClass of ALL_CLASSES) {
      expect(REQUEST_CLASS_MIN_TIER[requestClass]).toBeDefined()
    }
  })

  it('el mapa no tiene entradas de más', () => {
    expect(Object.keys(REQUEST_CLASS_MIN_TIER).sort()).toEqual([...ALL_CLASSES].sort())
  })

  it('todo valor del mapa es un Tier válido', () => {
    for (const tier of Object.values(REQUEST_CLASS_MIN_TIER)) {
      expect(isTier(tier)).toBe(true)
    }
  })
})

describe('TIER_ORDER', () => {
  it('es un orden total estricto', () => {
    expect(TIER_ORDER.free).toBeLessThan(TIER_ORDER.weekly)
    expect(TIER_ORDER.weekly).toBeLessThan(TIER_ORDER.advanced)
  })
})

describe('isTier', () => {
  it('acepta los tres tiers y rechaza el resto', () => {
    expect(isTier('free')).toBe(true)
    expect(isTier('weekly')).toBe(true)
    expect(isTier('advanced')).toBe(true)
    expect(isTier('pro')).toBe(false)
    expect(isTier(null)).toBe(false)
    expect(isTier(2)).toBe(false)
  })
})
