import { describe, expect, it } from 'vitest'
import type { AIRawResponse, AIRequestClass } from '../../../types'
import { isClassAllowed } from '../../entitlements/entitlementPolicy'
import { normalizeResponse } from '../responseNormalizer'

const CREATE_WEEK_TEXT = JSON.stringify({
  message: 'Te armo la semana.',
  actions: [{
    type: 'create_week',
    reason: 'Semana solicitada',
    targetDate: '2026-08-17',
    sessions: [{
      date: '2026-08-17',
      timeBlock: 'PM',
      sessionType: 'running',
      title: 'Rodaje suave',
      durationMin: 40,
      objective: 'Base aerobica',
    }],
  }],
})

function raw(text: string, requestClass: AIRequestClass): AIRawResponse {
  return { text, requestClass, provider: 'gemini' } as AIRawResponse
}

describe('BARRERA DE NEGOCIO: create_week nunca sale de chat_action', () => {
  // Este filtro dejo de ser una regla de calidad: es lo que impide que un
  // usuario free obtenga una semana generada por la via del chat, sin pasar
  // por el gate de `week_creator`. No retirarlo sin leer el spec §3.4.
  it('chat_action descarta la accion create_week', () => {
    const result = normalizeResponse(raw(CREATE_WEEK_TEXT, 'chat_action'))
    expect(result.actions?.some((action) => action.type === 'create_week')).toBeFalsy()
  })

  it('emite el diagnostico neutro filteredCreateWeek', () => {
    expect(normalizeResponse(raw(CREATE_WEEK_TEXT, 'chat_action')).filteredCreateWeek).toBe(true)
  })

  it('sin create_week el diagnostico es false', () => {
    const plain = JSON.stringify({ message: 'Hola.', actions: [] })
    expect(normalizeResponse(raw(plain, 'chat_action')).filteredCreateWeek).toBe(false)
  })

  it('week_creator NO filtra: ahi la accion es legitima', () => {
    const result = normalizeResponse(raw(CREATE_WEEK_TEXT, 'week_creator'))
    expect(result.actions?.some((action) => action.type === 'create_week')).toBe(true)
    expect(result.filteredCreateWeek).toBe(false)
  })

  it('el normalizador NO recibe tier: emite igual para todos', () => {
    // La firma toma un solo argumento a proposito. Si algun dia recibe el tier,
    // hay que releer el spec §6.1: la decision comercial vive en presentacion.
    expect(normalizeResponse.length).toBe(1)
  })
})

describe('la traduccion a oferta depende del tier, no del diagnostico', () => {
  it('weekly NO ve la tarjeta aunque el diagnostico se emita', () => {
    const result = normalizeResponse(raw(CREATE_WEEK_TEXT, 'chat_action'))
    expect(result.filteredCreateWeek).toBe(true)
    expect(isClassAllowed('weekly', 'week_creator')).toBe(true)
  })

  it('advanced NO ve la tarjeta aunque el diagnostico se emita', () => {
    expect(isClassAllowed('advanced', 'week_creator')).toBe(true)
  })

  it('free SI la ve', () => {
    expect(isClassAllowed('free', 'week_creator')).toBe(false)
  })
})
