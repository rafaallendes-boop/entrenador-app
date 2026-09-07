/**
 * Normalización de ruta para el reporter de errores de cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §4.
 *
 * Nunca se envía la ruta cruda. `/day/2026-08-23` lleva una fecha; el patrón
 * `/day/:date` no lleva nada. Query y hash se descartan **antes** de reconocer,
 * porque son el vehículo más probable de un token o de un dato de usuario.
 *
 * Lo que no está en `ROUTES` es `unknown`: una ruta no reconocida no se
 * transcribe «por si sirve».
 */

import { ROUTES } from '../../constants/routes'

export const UNKNOWN_ROUTE = 'unknown'

/** Patrón del único parámetro de ruta del proyecto. */
export const DAY_ROUTE_PATTERN = '/day/:date'

/**
 * Rutas servidas sin sesión. Se declaran acá y no se derivan de `ROUTES`
 * porque «pública» es una propiedad del enrutado en `App.tsx`, no del nombre.
 *
 * `ROUTES.HOME` queda **fuera** a propósito: dentro de `AuthGate` esa ruta
 * renderiza el `Dashboard`, y v1 sólo captura usuarios autenticados (D4). Como
 * la severidad rebaja a `baja` los `unknown` de rutas públicas, incluirla
 * habría degradado los errores de la pantalla principal del producto.
 */
const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  ROUTES.FEATURES,
  ROUTES.PRICING,
  ROUTES.COACHES,
  ROUTES.TERMS,
  ROUTES.PRIVACY,
  ROUTES.HEALTH_DISCLAIMER,
  ROUTES.WHOOP_DISCLAIMER,
  ROUTES.IOS_WELCOME_PREVIEW,
])

/** Rutas estáticas reconocidas: todo `ROUTES` salvo el constructor de día. */
const STATIC_ROUTES: ReadonlySet<string> = new Set(
  (Object.values(ROUTES) as readonly unknown[]).filter(
    (value): value is string => typeof value === 'string',
  ),
)

const RECOGNIZED_ROUTES: ReadonlySet<string> = new Set([
  ...STATIC_ROUTES,
  DAY_ROUTE_PATTERN,
])

/** Quita query y hash, y la barra final que no sea la raíz. */
function stripToPath(raw: string): string {
  const withoutHash = raw.split('#', 1)[0] ?? ''
  const withoutQuery = withoutHash.split('?', 1)[0] ?? ''
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1)
  }
  return withoutQuery
}

/**
 * Total y determinista. Recibe un `pathname`; una URL absoluta no es un
 * pathname y se reporta como desconocida en vez de recortarse a ciegas.
 */
export function normalizeRoute(rawPath: unknown): string {
  if (typeof rawPath !== 'string') return UNKNOWN_ROUTE

  const path = stripToPath(rawPath)
  if (!path.startsWith('/')) return UNKNOWN_ROUTE

  if (RECOGNIZED_ROUTES.has(path)) return path

  // Único parámetro del proyecto. El segmento se descarta siempre: no se
  // valida su forma porque no se persiste.
  const segments = path.split('/')
  if (segments.length === 3 && segments[1] === 'day' && segments[2] !== '') {
    return DAY_ROUTE_PATTERN
  }

  return UNKNOWN_ROUTE
}

/** Una ruta desconocida no se presume pública (§6, regla de severidad). */
export function isPublicRoute(route: string): boolean {
  return PUBLIC_ROUTES.has(route)
}

/** Sólo para pruebas de contrato y paridad cliente/servidor. */
export function recognizedRoutesSnapshot(): readonly string[] {
  return [...RECOGNIZED_ROUTES].sort()
}
