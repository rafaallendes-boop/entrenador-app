import { describe, expect, it } from 'vitest'

import { resolveStrengthSafetyConstraints } from '../strengthSafetyConstraints'

function keys(text: string, field: 'currentInjuries' | 'restrictions' = 'currentInjuries'): string[] {
  return resolveStrengthSafetyConstraints({ [field]: text })
    .map((constraint) => constraint.kind === 'region'
      ? `region:${constraint.region}`
      : constraint.kind === 'load_pattern' ? `pattern:${constraint.pattern}` : constraint.kind)
}

describe('reconocimiento de ausencia en campos médicos', () => {
  // El campo de lesiones es de texto libre y la respuesta abrumadoramente
  // mayoritaria es "no tengo nada". Antes de este fix el centinela era una
  // igualdad exacta sobre el campo completo, así que un punto final bastaba
  // para bloquear toda la fuerza del atleta de forma permanente.
  it('trata las declaraciones de ausencia como ausencia, no como restricción sin resolver', () => {
    for (const text of [
      'Ninguna', 'Ninguna.', 'ninguna!', 'Ninguno.', 'Nada.', 'N/A.',
      'Ninguna lesión', 'Ninguna lesion por ahora', 'Ninguna por ahora',
      'todo bien', 'Todo bien.', 'todo ok', 'sin novedades', 'nada que reportar',
      'sin lesiones', 'no tengo lesiones', 'sin molestias',
    ]) {
      expect(keys(text), `"${text}" debería resolver sin restricción`).toEqual([])
    }
  })

  it('trata una lesión declarada como pasada como resuelta', () => {
    for (const text of [
      'ya recuperado de mi lesion de rodilla',
      'Ya me recuperé de la lesión de hombro',
      'ya estoy recuperado de la tendinitis',
    ]) {
      expect(keys(text), `"${text}" debería resolver sin restricción`).toEqual([])
    }
  })

  it('NO relaja una lesión vigente ni una recuperación en curso', () => {
    expect(keys('Lesión espalda baja, cuadrado lumbar')).toEqual(['region:lumbar'])
    expect(keys('tendinitis rotuliana')).toContain('region:knee')
    expect(keys('en recuperacion de lesion de rodilla')).toContain('region:knee')
    expect(keys('me estoy recuperando de una lesion de hombro')).toContain('region:shoulder')
    // Texto médico que no identifica zona sigue siendo fail-closed.
    expect(keys('me duele algo raro al entrenar')).toEqual(['unresolved_medical_restriction'])
  })

  it('una recuperación NEGADA o en curso nunca se lee como ausencia', () => {
    // El token de evitación "no " combinado con un objeto sintomático
    // ("lesión") leía "no estoy recuperado de la lesión de rodilla" como si el
    // atleta declarara no tener nada. Dice exactamente lo contrario.
    expect(keys('no estoy recuperado de la lesion de rodilla')).toContain('region:knee')
    expect(keys('todavia no me recupero de la lesion de hombro')).toContain('region:shoulder')
    expect(keys('aun no estoy recuperado del esguince de tobillo')).toContain('region:ankle')
    expect(keys('sigo lesionado de la rodilla')).toContain('region:knee')
  })

  it('no confunde ausencia parcial con ausencia total', () => {
    // "ninguna" acá califica sólo a una cláusula; la otra sigue vigente.
    expect(keys('ninguna molestia de hombro, pero tengo dolor lumbar')).toEqual(['region:lumbar'])
  })

  it('mantiene fail-closed cuando la resolución vive en otra cláusula', () => {
    // Deliberado: el parser clasifica por cláusula y no infiere que "ya dado de
    // alta" se refiere a la lesión nombrada antes. Resolver esto exigiría
    // inferencia entre cláusulas, que es justo lo que el diseño evita. Ante la
    // duda se conserva la exclusión.
    expect(keys('lesión lumbar, ya dado de alta')).toEqual(['region:lumbar'])
  })
})
