/**
 * Puente entre `syncLog` y el reporter de errores de cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §6 y §7.
 *
 * Sync es el caso que **no** llega por un boundary: sus errores se atrapan y se
 * tragan, así que sin este puente son invisibles. Es también el que motivó el
 * `sync_contract_failure` de la taxonomía — un `schema_mismatch` no cabe en
 * ninguna de las ocho categorías de navegador.
 *
 * Dos restricciones que vienen del spec y no son negociables:
 *
 *  - **Sólo los tres eventos terminales.** Un `non_retriable` significa que la
 *    cola se rindió. Reportar cada 409 reintentable o cada corte de red
 *    inundaría el canal con estados normales de operación.
 *  - **Nunca se transmiten los `details` de `syncLog`.** Traen tabla, ids y
 *    fragmentos de fila. Sólo cruza la categoría tipada, que es un valor de una
 *    unión cerrada que escribimos nosotros.
 */

import type { SyncErrorCategory } from '../syncUtils'
import type { CaptureContext } from './installClientErrorReporter'

/** Los tres puntos donde la cola declara que se rindió. */
const TERMINAL_SYNC_EVENTS: ReadonlySet<string> = new Set([
  'upsertRow:non_retriable',
  'deleteRow:non_retriable',
  'runFullSync:non_retriable',
])

const SYNC_CATEGORIES: ReadonlySet<string> = new Set<SyncErrorCategory>([
  'duplicate_remote_profile',
  'schema_mismatch',
  'network_error',
  'auth_error',
  'validation_error',
  'supabase_not_configured',
  'rls_error',
  'unknown_error',
])

export type SyncFailureCapture = (context: CaptureContext) => void

/**
 * Se llama desde `syncLog` con su evento y sus `details` crudos. Filtra, extrae
 * **sólo** la categoría y delega. Total y silenciosa: observar el sync no puede
 * romper el sync.
 */
export function captureSyncFailure(
  event: string,
  details: Record<string, unknown>,
  capture: SyncFailureCapture,
): void {
  try {
    if (!TERMINAL_SYNC_EVENTS.has(event)) return

    const category = details['category']
    if (typeof category !== 'string' || !SYNC_CATEGORIES.has(category)) return

    capture({
      source: 'sync_failure',
      // El clasificador resuelve por categoría y no toca este objeto.
      error: null,
      // Sin objeto de error no hay `name` que leer. Declararlo evita que la
      // fila diga `InvalidName`, que por contrato significa «la forma falló».
      errorName: 'SyncError',
      syncCategory: category as SyncErrorCategory,
      component: 'SyncService',
    })
  } catch {
    // Nunca propaga: el peor caso es perder la observación, no el sync.
  }
}
