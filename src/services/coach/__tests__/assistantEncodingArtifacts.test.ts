import { describe, expect, it } from 'vitest'

import { parseAssistantMessageResult } from '../assistantMessage'

const parse = (body: string) => parseAssistantMessageResult(JSON.stringify({ body }))

describe('detección de corrupción de codificación', () => {
  // La corrupción observada reemplaza un carácter multibyte por un hueco. Eso
  // produce una familia ABIERTA de artefactos, no dos literales: cualquier
  // palabra española con tilde puede partirse. Fijar sólo `d ias` y `alg n`
  // dejaba pasar `m s`, `sesi n`, `Tambi n` y `C mo`, todas más probables.
  it('rechaza la familia completa, no sólo los dos casos observados', () => {
    for (const body of [
      'Llevas 17 d ias sin registrar.',
      'Hay alg n problema?',
      'Vas m s cargado de lo normal.',
      'Tu sesi n de hoy qued pendiente.',
      'Tambi n vi tu check-in.',
      'C mo te sientes?',
      'Tu pr xima semana arranca fuerte.',
    ]) {
      expect(parse(body).ok, body).toBe(false)
    }
  })

  it('sigue rechazando el reemplazo explícito U+FFFD', () => {
    expect(parse('Llevas 17 d�as sin registrar.').ok).toBe(false)
  })

  it('no rechaza español legítimo, con o sin tildes', () => {
    for (const body of [
      'Llevas 17 días sin registrar y tienes 9 sesiones pendientes. ¿Cómo te sientes?',
      'Vas más cargado de lo normal, ¿algún problema con la rodilla?',
      // Palabras de una letra que SÍ existen en español.
      'Descansa y avisame si hay dolor o molestia.',
      'Te dejo una sesion suave, a modo de transicion.',
      'Trabajo en zona 2 y luego movilidad.',
      'Haz 3 series de 8 repeticiones con RPE 7.',
      // Notación con dígitos: no es prosa y no debe leerse como corrupción.
      'Te propuse 3x8 y un bloque Z2 de 30 min.',
      'Corre 5k suave y avisame como te sentiste.',
    ]) {
      expect(parse(body).ok, body).toBe(true)
    }
  })
})
