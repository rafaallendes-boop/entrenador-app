import { describe, expect, it } from 'vitest'

import { detectSupersetIntent } from '../supersetPolicy'

describe('detectSupersetIntent', () => {
  it('reconoce formas positivas', () => {
    expect(detectSupersetIntent('armamelo en superseries')).toBe('requested')
    expect(detectSupersetIntent('quiero los ejercicios agrupados')).toBe('requested')
    expect(detectSupersetIntent('hacelo en circuito')).toBe('requested')
    expect(detectSupersetIntent('meteme una triserie')).toBe('requested')
  })

  // La distincion que importa: no mencionar nada deja decidir a la politica,
  // rechazar explicitamente la apaga. Un booleano colapsaba los dos casos y
  // agrupaba igual cuando el atleta habia dicho que no.
  it('devuelve undefined cuando no hay mencion', () => {
    expect(detectSupersetIntent('armame la sesion de fuerza del martes')).toBeUndefined()
  })

  it('reconoce negaciones como rechazo explicito, no como ausencia', () => {
    expect(detectSupersetIntent('sin superseries por favor')).toBe('declined')
    expect(detectSupersetIntent('nada de circuitos')).toBe('declined')
    expect(detectSupersetIntent('no los agrupes')).toBe('declined')
  })

  it('hace prevalecer la ultima mencion explicita', () => {
    expect(detectSupersetIntent(
      'no quiero superseries. dale, armamelo en superseries',
    )).toBe('requested')
    expect(detectSupersetIntent(
      'armamelo en superseries. mejor sin superseries',
    )).toBe('declined')
  })

  it('reconoce las conjugaciones agrupes y agrupen como menciones', () => {
    expect(detectSupersetIntent('no los agrupes')).toBe('declined')
    expect(detectSupersetIntent('en superseries; finalmente no los agrupes')).toBe('declined')
    expect(detectSupersetIntent('no los agrupen; mejor si, en superseries')).toBe('requested')
  })

  it('tolera mayusculas y tildes', () => {
    expect(detectSupersetIntent('ARMÁMELO EN SUPERSERIES')).toBe('requested')
    expect(detectSupersetIntent('SIN SUPERSERIES')).toBe('declined')
  })
})
