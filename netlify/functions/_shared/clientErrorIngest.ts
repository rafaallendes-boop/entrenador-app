/**
 * Ingesta de errores de cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §7.
 *
 * Orquesta validación → techo durable → inserción. La RPC entra inyectada para
 * que el contrato se pueda probar sin red; el handler le pasa la real.
 *
 * Dos reglas que no se relajan:
 *   * **Si el control durable falla, no se inserta por ninguna otra vía.** Un
 *     camino alternativo convertiría el techo en decorativo justo cuando la base
 *     está en problemas.
 *   * **La telemetría nunca altera el resultado del producto.** El peor caso de
 *     este módulo es perder un evento, nunca romper la operación que lo produjo.
 */

import {
  buildClientErrorRow,
  type ClientErrorRow,
} from './clientErrorPayload'
import type { ReleaseCatalog } from '../../../src/services/observability/releaseCatalog'

/** Techo durable por cuenta, en ventana móvil. */
export const CLIENT_ERROR_RATE_LIMIT = 30
export const CLIENT_ERROR_RATE_WINDOW_SECONDS = 3600

export type IngestOutcome =
  | { readonly ok: true; readonly inserted: boolean }
  | { readonly ok: false; readonly status: 400 | 413 | 503; readonly reason: string }

export interface IngestDeps {
  readonly callRpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>
  readonly catalog: ReleaseCatalog
  /**
   * Interruptor server-only. La flag `VITE_*` se resuelve en build y no apaga
   * las pestañas ya desplegadas; esto sí corta su ingesta sin redeploy del cliente.
   */
  readonly ingestionEnabled: boolean
}

export interface IngestInput {
  readonly rawBody: string
  readonly userId: string
}

/** Traduce la fila a los parámetros de la RPC. Nada fuera de la allowlist viaja. */
function rpcArgs(row: ClientErrorRow): Record<string, unknown> {
  return {
    p_user_id: row.user_id,
    p_scope_kind: row.scope_kind,
    p_source: row.source,
    p_diagnostic_code: row.diagnostic_code,
    p_fingerprint: row.fingerprint,
    p_error_name: row.error_name,
    p_stack_frames: row.stack_frames,
    p_component: row.component,
    p_route: row.route,
    p_request_class: row.request_class,
    p_release: row.release,
    p_platform: row.platform,
    p_limit: CLIENT_ERROR_RATE_LIMIT,
    p_window_seconds: CLIENT_ERROR_RATE_WINDOW_SECONDS,
  }
}

/** La RPC devuelve `[{ inserted, used }]`. Cualquier otra forma es un fallo. */
function readInserted(result: unknown): boolean | null {
  if (!Array.isArray(result) || result.length === 0) return null
  const first = result[0] as Record<string, unknown> | undefined
  if (typeof first !== 'object' || first === null) return null
  const inserted = first['inserted']
  return typeof inserted === 'boolean' ? inserted : null
}

export async function ingestClientError(
  input: IngestInput,
  deps: IngestDeps,
): Promise<IngestOutcome> {
  // Defensa en profundidad: la construcción de la fila es total por contrato,
  // pero un throw acá subiría al handler como 500 disparable por cualquier
  // cliente autenticado. Un bug interno se reporta como contrato inválido, no
  // como caída del servidor.
  let built: ReturnType<typeof buildClientErrorRow>
  try {
    built = buildClientErrorRow({
      rawBody: input.rawBody,
      userId: input.userId,
      catalog: deps.catalog,
    })
  } catch {
    return { ok: false, status: 400, reason: 'no se pudo construir el evento' }
  }
  if (!built.ok) return built

  // Se valida igual con la ingesta apagada: así el interruptor no esconde un
  // cliente que empezó a mandar basura.
  if (!deps.ingestionEnabled) return { ok: true, inserted: false }

  let result: unknown
  try {
    result = await deps.callRpc('insert_client_error_event', rpcArgs(built.row))
  } catch {
    // El detalle crudo no cruza: puede traer el cuerpo de PostgREST, y con él
    // fragmentos de la fila. El handler responde 5xx genérico.
    return { ok: false, status: 503, reason: 'ingesta no disponible' }
  }

  const inserted = readInserted(result)
  if (inserted === null) {
    return { ok: false, status: 503, reason: 'respuesta de ingesta ilegible' }
  }

  return { ok: true, inserted }
}
