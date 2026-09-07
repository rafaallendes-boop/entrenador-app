import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_CODES, CLIENT_ERROR_SOURCES } from '../clientErrorContract'
import { UNKNOWN_ROUTE } from '../routeNormalizer'
import { deriveSeverity } from '../errorSeverity'

describe('deriveSeverity — regla 1: alta', () => {
  it('marca alta cualquier fallo de sync, sin mirar la ruta', () => {
    expect(
      deriveSeverity({ source: 'sync_failure', diagnosticCode: 'network_failure', route: '/' }),
    ).toBe('alta')
  })

  it('marca alta storage_failure en cualquier ruta, incluso pública', () => {
    expect(
      deriveSeverity({ source: 'window_error', diagnosticCode: 'storage_failure', route: '/coaches' }),
    ).toBe('alta')
  })

  it.each(['/coach', '/chat', '/plan-builder', '/plans/builder', '/competition-plan'])(
    'marca alta el área crítica %s',
    (route) => {
      expect(
        deriveSeverity({ source: 'react_boundary', diagnosticCode: 'render_failure', route }),
      ).toBe('alta')
    },
  )
})

describe('deriveSeverity — regla 2: baja', () => {
  it('marca baja third_party_failure fuera de área crítica', () => {
    expect(
      deriveSeverity({ source: 'window_error', diagnosticCode: 'third_party_failure', route: '/settings' }),
    ).toBe('baja')
  })

  it('marca baja unknown en una ruta pública reconocida', () => {
    expect(
      deriveSeverity({ source: 'window_error', diagnosticCode: 'unknown', route: '/coaches' }),
    ).toBe('baja')
  })

  // La regla 1 se evalúa antes: dentro de un área crítica no hay baja.
  it('no baja la severidad de third_party_failure dentro de un área crítica', () => {
    expect(
      deriveSeverity({ source: 'window_error', diagnosticCode: 'third_party_failure', route: '/coach' }),
    ).toBe('alta')
  })
})

describe('deriveSeverity — regla 3: media', () => {
  it('marca media el resto', () => {
    expect(
      deriveSeverity({ source: 'window_error', diagnosticCode: 'chunk_load', route: '/settings' }),
    ).toBe('media')
  })

  // §6: «Una ruta desconocida no se presume pública.»
  it('marca media un unknown en ruta desconocida, no baja', () => {
    expect(
      deriveSeverity({ source: 'window_error', diagnosticCode: 'unknown', route: UNKNOWN_ROUTE }),
    ).toBe('media')
  })

  // La raíz autenticada es el Dashboard, no la landing.
  it('marca media un unknown en la raíz, no baja', () => {
    expect(
      deriveSeverity({ source: 'window_error', diagnosticCode: 'unknown', route: '/' }),
    ).toBe('media')
  })
})

describe('deriveSeverity — totalidad', () => {
  it('devuelve una severidad válida para toda combinación de la taxonomía', () => {
    const rutas = ['/', '/coaches', '/coach', '/settings', '/day/:date', UNKNOWN_ROUTE]
    for (const source of CLIENT_ERROR_SOURCES) {
      for (const diagnosticCode of DIAGNOSTIC_CODES) {
        for (const route of rutas) {
          expect(['alta', 'media', 'baja']).toContain(
            deriveSeverity({ source, diagnosticCode, route }),
          )
        }
      }
    }
  })

  it('es determinista: la misma entrada da siempre lo mismo', () => {
    const entrada = { source: 'window_error', diagnosticCode: 'unknown', route: '/coaches' } as const
    expect(deriveSeverity(entrada)).toBe(deriveSeverity(entrada))
  })
})
