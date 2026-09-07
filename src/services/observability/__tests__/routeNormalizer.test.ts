import { describe, expect, it } from 'vitest'
import { UNKNOWN_ROUTE, isPublicRoute, normalizeRoute } from '../routeNormalizer'

describe('normalizeRoute', () => {
  it('conserva una ruta estática reconocida', () => {
    expect(normalizeRoute('/week')).toBe('/week')
    expect(normalizeRoute('/coach')).toBe('/coach')
  })

  it('reconoce la ruta real del Plan Builder V2', () => {
    expect(normalizeRoute('/plans/builder')).toBe('/plans/builder')
  })

  it('colapsa el día concreto en su patrón', () => {
    expect(normalizeRoute('/day/2026-08-23')).toBe('/day/:date')
  })

  // El segmento se descarta, así que da igual qué traiga: nunca se persiste.
  it('colapsa el patrón de día aunque el segmento traiga un dato', () => {
    expect(normalizeRoute('/day/rafa@example.com')).toBe('/day/:date')
  })

  it('descarta query y hash antes de reconocer la ruta', () => {
    expect(normalizeRoute('/week?token=secreto')).toBe('/week')
    expect(normalizeRoute('/week#seccion')).toBe('/week')
    expect(normalizeRoute('/day/2026-08-23?token=secreto#x')).toBe('/day/:date')
  })

  it('tolera una barra final', () => {
    expect(normalizeRoute('/week/')).toBe('/week')
  })

  it('reconoce la raíz', () => {
    expect(normalizeRoute('/')).toBe('/')
  })

  it('devuelve unknown para una ruta que no está en ROUTES', () => {
    expect(normalizeRoute('/no-existe')).toBe(UNKNOWN_ROUTE)
  })

  it('devuelve unknown si el patrón de día trae segmentos de más', () => {
    expect(normalizeRoute('/day/2026-08-23/extra')).toBe(UNKNOWN_ROUTE)
  })

  it('devuelve unknown para cualquier valor que no sea string', () => {
    expect(normalizeRoute(undefined)).toBe(UNKNOWN_ROUTE)
    expect(normalizeRoute(null)).toBe(UNKNOWN_ROUTE)
    expect(normalizeRoute(123)).toBe(UNKNOWN_ROUTE)
  })

  it('devuelve unknown para una URL absoluta, no su pathname', () => {
    expect(normalizeRoute('https://app.rallyiq.cl/week')).toBe(UNKNOWN_ROUTE)
  })

  it('es idempotente', () => {
    expect(normalizeRoute(normalizeRoute('/day/2026-08-23'))).toBe('/day/:date')
    expect(normalizeRoute(normalizeRoute('/no-existe'))).toBe(UNKNOWN_ROUTE)
  })
})

describe('isPublicRoute', () => {
  it('reconoce las rutas públicas de la landing y legales', () => {
    expect(isPublicRoute('/coaches')).toBe(true)
    expect(isPublicRoute('/privacy')).toBe(true)
    expect(isPublicRoute('/features')).toBe(true)
  })

  it('no considera pública una ruta autenticada', () => {
    expect(isPublicRoute('/coach')).toBe(false)
    expect(isPublicRoute('/plans/builder')).toBe(false)
  })

  // `/` dentro de AuthGate renderiza el Dashboard. Como v1 sólo captura
  // usuarios autenticados (D4), tratarla como pública rebajaría a `baja` los
  // errores de la pantalla principal del producto.
  it('no considera pública la raíz, que autenticada es el Dashboard', () => {
    expect(isPublicRoute('/')).toBe(false)
  })

  // §6: «Una ruta desconocida no se presume pública.»
  it('no considera pública una ruta desconocida', () => {
    expect(isPublicRoute(UNKNOWN_ROUTE)).toBe(false)
  })
})
