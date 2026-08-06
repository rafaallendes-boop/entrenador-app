import { describe, expect, it } from 'vitest'

import { detectSupersetPreference } from '../supersetPolicy'

describe('detectSupersetPreference', () => {
  it('reconoce formas positivas', () => {
    expect(detectSupersetPreference('armamelo en superseries')).toBe(true)
    expect(detectSupersetPreference('quiero los ejercicios agrupados')).toBe(true)
    expect(detectSupersetPreference('hacelo en circuito')).toBe(true)
    expect(detectSupersetPreference('meteme una triserie')).toBe(true)
  })

  it('devuelve false cuando no hay mencion', () => {
    expect(detectSupersetPreference('armame la sesion de fuerza del martes')).toBe(false)
  })

  it('respeta negaciones', () => {
    expect(detectSupersetPreference('sin superseries por favor')).toBe(false)
    expect(detectSupersetPreference('nada de circuitos')).toBe(false)
    expect(detectSupersetPreference('no los agrupes')).toBe(false)
  })

  it('hace prevalecer la ultima mencion explicita', () => {
    expect(detectSupersetPreference(
      'no quiero superseries. dale, armamelo en superseries',
    )).toBe(true)
    expect(detectSupersetPreference(
      'armamelo en superseries. mejor sin superseries',
    )).toBe(false)
  })

  it('reconoce las conjugaciones agrupes y agrupen como menciones', () => {
    expect(detectSupersetPreference('no los agrupes')).toBe(false)
    expect(detectSupersetPreference('en superseries; finalmente no los agrupes')).toBe(false)
    expect(detectSupersetPreference('no los agrupen; mejor si, en superseries')).toBe(true)
  })

  it('tolera mayusculas y tildes', () => {
    expect(detectSupersetPreference('ARMÁMELO EN SUPERSERIES')).toBe(true)
  })
})
