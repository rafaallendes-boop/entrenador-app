/**
 * Severidad derivada de un error de cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §6.
 *
 * **No se persiste.** La severidad es un juicio y los juicios se recalibran;
 * los hechos que la alimentan —`source`, `diagnostic_code`, ruta— no. Cambiar
 * esta regla cambia también la lectura de los eventos históricos, sin reescribir
 * ninguna fila y sin migración.
 *
 * La misma función se evalúa en el panel y en el servidor: una sola autoridad.
 */

import type {
  ClientErrorSeverity,
  ClientErrorSource,
  DiagnosticCode,
} from './clientErrorContract'
import { isPublicRoute } from './routeNormalizer'

export interface SeverityInput {
  readonly source: ClientErrorSource
  readonly diagnosticCode: DiagnosticCode
  readonly route: string
}

/**
 * Áreas donde un error rompe el valor central del producto. Se declaran por
 * ruta normalizada, no por nombre de componente, para que la regla se pueda
 * evaluar también en SQL/servidor sobre la fila ya persistida.
 */
const CRITICAL_ROUTES: ReadonlySet<string> = new Set([
  '/coach',
  '/chat',
  '/plan-builder',
  '/plans/builder',
  '/competition-plan',
])

/** Primera regla aplicable gana. */
export function deriveSeverity(input: SeverityInput): ClientErrorSeverity {
  // 1 — alta.
  if (input.source === 'sync_failure') return 'alta'
  if (input.diagnosticCode === 'storage_failure') return 'alta'
  if (CRITICAL_ROUTES.has(input.route)) return 'alta'

  // 2 — baja.
  if (input.diagnosticCode === 'third_party_failure') return 'baja'
  if (input.diagnosticCode === 'unknown' && isPublicRoute(input.route)) return 'baja'

  // 3 — media. Incluye la ruta desconocida: no se presume pública.
  return 'media'
}
