import { describe, expect, it } from 'vitest'
import { supabaseOperationError } from '../_shared/supabaseError'

/**
 * supabase-js sólo construye un `PostgrestError` (que sí extiende `Error`)
 * cuando se pidió `throwOnError`. En el camino normal devuelve el cuerpo de
 * PostgREST **parseado como objeto plano**, así que `error instanceof Error`
 * es falso y `String(error)` da `[object Object]`.
 *
 * Ese es exactamente el log que dejó el fallo de producción del 2026-09-05:
 *
 *   [enqueue-plan] error planId=dfe73b77-…: [object Object]
 *
 * — un 500 reproducible sin una sola pista de la causa. Estos tests fijan que
 * ninguna forma de error pueda volver a perder el diagnóstico.
 */
describe('supabaseOperationError', () => {
  const postgrest = {
    message: 'new row violates row-level security policy for table "training_plan_weeks"',
    details: null,
    hint: null,
    code: '42501',
  }

  it('convierte el objeto plano de PostgREST en un Error con causa legible', () => {
    const error = supabaseOperationError('putWeek', postgrest)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('putWeek')
    expect(error.message).toContain('row-level security policy')
    expect(error.message).toContain('42501')
  })

  // El consumidor real es `error instanceof Error ? error.message : String(error)`
  // en las dos funciones de generación. Ese formateo es el que fallaba.
  it('nunca produce [object Object] al formatearse como lo hacen las Functions', () => {
    for (const raw of [postgrest, { unexpected: true }, 'texto plano', null, undefined]) {
      const error = supabaseOperationError('getPlan', raw)
      const formatted = error instanceof Error ? error.message : String(error)
      expect(formatted).not.toContain('[object Object]')
      expect(formatted).toContain('getPlan')
    }
  })

  it('conserva code, details y hint para diagnóstico programático', () => {
    const error = supabaseOperationError('putPlan', { ...postgrest, details: 'd', hint: 'h' })
    expect(error.code).toBe('42501')
    expect(error.details).toBe('d')
    expect(error.hint).toBe('h')
  })

  // Una forma desconocida no puede degradar a `[object Object]`: se serializa.
  it('serializa una forma desconocida en vez de perderla', () => {
    const error = supabaseOperationError('checkCancelled', { weird: 1, nested: { a: 2 } })
    expect(error.message).toContain('weird')
    expect(error.message).toContain('nested')
  })

  // Un Error real ya es diagnosticable: se conserva su mensaje y se anota la
  // operación, sin envolverlo en una capa que esconda el stack original.
  it('conserva un Error real y lo expone como cause', () => {
    const original = new Error('Timeout after 15000ms: putWeek')
    const error = supabaseOperationError('putWeek', original)
    expect(error.message).toContain('Timeout after 15000ms')
    expect(error.cause).toBe(original)
  })
})
