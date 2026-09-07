/**
 * Clasificador de errores de cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §6.
 *
 * Es **la única pieza que toca el error crudo, y su salida nunca sale del
 * dispositivo**: mira el error en memoria y emite un `diagnostic_code` de la
 * lista cerrada, o la decisión de no emitir nada. El mensaje no se envía, no se
 * almacena y no se registra — inspeccionarlo acá para *descartar* ruido es
 * legítimo justamente porque el resultado es una categoría, no el texto.
 *
 * Las reglas se evalúan **en orden fijo y la primera que matchea gana**. El
 * orden está congelado por tests; reordenarlo cambia resultados reales.
 *
 * Dos principios que explican las decisiones menos obvias:
 *
 *  - **No adivinar.** Sync y `AIProviderError` entran como uniones tipadas, no
 *    como inspección de texto. Y un `TypeError` pelado **no** se presume fallo
 *    de red: es el bug más común de JavaScript, así que sin señal explícita cae
 *    en `unknown`. Un `unknown` honesto es información; una etiqueta inventada
 *    contamina el instrumento que mide la calidad del clasificador.
 *  - **La causa gana sobre la superficie.** Un `import()` perezoso que falla
 *    dentro de `Suspense` estalla en el boundary: es `chunk_load`, no
 *    `render_failure`. `render_failure` es el fallback del boundary.
 */

import { AIProviderError } from '../ai/types'
import type { AIErrorCode } from '../ai/types'
import type { SyncErrorCategory } from '../syncUtils'
import type {
  ClientErrorIgnoreReason,
  ClientErrorSource,
  DiagnosticCode,
} from './clientErrorContract'

export interface ClassificationInput {
  readonly source: ClientErrorSource
  readonly error: unknown
  /** `ErrorEvent.message`. Sólo se usa para descartar ruido; nunca se persiste. */
  readonly message?: string | null
  /** `ErrorEvent.filename`. Sólo se usa para atribuir extensiones del navegador. */
  readonly filename?: string | null
  /** Categoría tipada de sync. Obligatoria cuando `source` es `sync_failure`. */
  readonly syncCategory?: SyncErrorCategory | null
  /**
   * Origen del aborto, resuelto por quien captura. `unknown` es el default y
   * **no** habilita el ignorado: un `AbortError` desconocido no demuestra
   * cancelación deliberada.
   */
  readonly abortOrigin?: 'fetch' | 'dexie' | 'unknown'
  /**
   * Afirmación de que **la descarga del asset falló**. No es «se disparó un
   * evento de carga de módulo»: es que el recurso no se pudo traer.
   *
   * `vite:preloadError` **no** la establece. El helper de Vite termina en
   * `baseModule().catch(handlePreloadError)`, así que el mismo evento se
   * dispara cuando el módulo se descargó bien y lanzó al evaluarse. Quien la
   * emita en B3 debe distinguir descarga de evaluación; hasta entonces usar
   * `moduleLoadEventFired`, que no fuerza ninguna categoría.
   */
  readonly chunkLoadSignal?: boolean
  /**
   * Se disparó `vite:preloadError`. Es **ambiguo por construcción** y no
   * clasifica por sí solo: se conserva como contexto para que B3 lo pueda
   * medir sin que un bug de inicialización se etiquete como `chunk_load`.
   */
  readonly moduleLoadEventFired?: boolean
  /** Señal explícita de fallo de red, emitida por el envoltorio de `fetch`. */
  readonly networkFailureSignal?: boolean
}

export type ClassificationOutcome =
  | { readonly kind: 'ignored'; readonly reason: ClientErrorIgnoreReason }
  | { readonly kind: 'classified'; readonly diagnosticCode: DiagnosticCode }

/** Rechazos de negocio: tienen UI propia y telemetría server-side. */
const BUSINESS_REJECTION_CODES: ReadonlySet<AIErrorCode> = new Set([
  'entitlement_required',
  'coach_access_required',
  'quota_exceeded',
  'spend_cap_exceeded',
  'kill_switch_active',
  'rate_limit',
])

const AI_ERROR_CODE_MAP: Readonly<Record<AIErrorCode, DiagnosticCode>> = {
  timeout: 'timeout',
  parse_error: 'data_parse_failure',
  truncated: 'data_parse_failure',
  server_error: 'network_failure',
  misconfigured: 'network_failure',
  unauthorized: 'network_failure',
  unknown: 'unknown',
  // Presentes por exhaustividad del tipo; se interceptan antes como ignorados.
  entitlement_required: 'unknown',
  coach_access_required: 'unknown',
  quota_exceeded: 'unknown',
  spend_cap_exceeded: 'unknown',
  kill_switch_active: 'unknown',
  rate_limit: 'unknown',
}

const SYNC_CATEGORY_MAP: Readonly<Record<SyncErrorCategory, DiagnosticCode>> = {
  schema_mismatch: 'sync_contract_failure',
  validation_error: 'data_parse_failure',
  duplicate_remote_profile: 'data_parse_failure',
  network_error: 'network_failure',
  auth_error: 'network_failure',
  rls_error: 'network_failure',
  supabase_not_configured: 'network_failure',
  unknown_error: 'unknown',
}

/** Nombres de IndexedDB y Dexie que indican fallo de almacenamiento local. */
const STORAGE_ERROR_NAMES: ReadonlySet<string> = new Set([
  'QuotaExceededError',
  'DatabaseClosedError',
  'VersionError',
  'InvalidStateError',
  'TransactionInactiveError',
  'ConstraintError',
  'UpgradeError',
  'SchemaError',
  'PrematureCommitError',
  'DexieError',
])

const EXTENSION_SCHEMES = [
  'chrome-extension://',
  'moz-extension://',
  'safari-web-extension://',
  'ms-browser-extension://',
]

/**
 * Lee `error.name` sin confiar en el objeto. Un valor de rechazo puede traer un
 * getter que lanza, o ser un `Proxy` con traps hostiles: si esto propagara, la
 * captura del error se rompería y perderíamos el evento **y** el que lo siguió.
 * Ante cualquier fallo de lectura devuelve `null`, que el clasificador resuelve
 * como `unknown` — una categoría honesta en vez de una excepción.
 */
export function readErrorName(error: unknown): string | null {
  try {
    if (error instanceof Error) return error.name
    if (typeof error === 'object' && error !== null && 'name' in error) {
      const name = (error as { name: unknown }).name
      return typeof name === 'string' ? name : null
    }
    return null
  } catch {
    return null
  }
}

/** `instanceof` también puede lanzar con un `Proxy` que intercepta el prototipo. */
function isAIProviderError(error: unknown): error is AIProviderError {
  try {
    return error instanceof AIProviderError
  } catch {
    return false
  }
}

function hasFilename(filename: string | null | undefined): boolean {
  return typeof filename === 'string' && filename.trim().length > 0
}

function isExtensionFilename(filename: string | null | undefined): boolean {
  if (!hasFilename(filename)) return false
  return EXTENSION_SCHEMES.some((scheme) => (filename as string).startsWith(scheme))
}

function classified(diagnosticCode: DiagnosticCode): ClassificationOutcome {
  return { kind: 'classified', diagnosticCode }
}

function ignored(reason: ClientErrorIgnoreReason): ClassificationOutcome {
  return { kind: 'ignored', reason }
}

export function classifyClientError(input: ClassificationInput): ClassificationOutcome {
  // Regla A — sync entra por categoría tipada, resuelta por quien capturó la
  // operación. Nunca se deduce del mensaje, y **no toca el error crudo**: se
  // resuelve antes de cualquier inspección para que un objeto hostil no pueda
  // afectar el único camino que ya tiene su respuesta.
  if (input.source === 'sync_failure') {
    const category = input.syncCategory
    if (category != null && category in SYNC_CATEGORY_MAP) {
      return classified(SYNC_CATEGORY_MAP[category])
    }
    return classified('unknown')
  }

  const name = readErrorName(input.error)

  // Regla 0 — `AIProviderError` manda porque no adivina: lee una unión tipada.
  if (isAIProviderError(input.error)) {
    if (BUSINESS_REJECTION_CODES.has(input.error.code)) return ignored('business_rejection')
    return classified(AI_ERROR_CODE_MAP[input.error.code] ?? 'unknown')
  }

  // Reglas de descarte. Van antes de las de forma para no gastar categorías en
  // ruido que no es un bug.
  if (name === 'AbortError' && input.abortOrigin === 'fetch') {
    return ignored('deliberate_abort')
  }
  if (typeof input.message === 'string' && input.message.startsWith('ResizeObserver loop')) {
    return ignored('resize_observer_loop')
  }
  // El motivo del descarte es que el evento es **no atribuible**, no que no sea
  // de una extensión: un `Script error.` con archivo propio sí se puede ubicar
  // y perderlo sería perder un error real. Sólo se ignora sin `filename`.
  if (
    typeof input.message === 'string' &&
    input.message.trim() === 'Script error.' &&
    !hasFilename(input.filename)
  ) {
    return ignored('opaque_script_error')
  }

  // Regla 1 — bundle stale tras un deploy. Es de las señales más útiles en beta.
  if (name === 'ChunkLoadError' || input.chunkLoadSignal === true) {
    return classified('chunk_load')
  }

  // Regla 2 — incluye el DOMException de `AbortSignal.timeout`.
  if (name === 'TimeoutError') return classified('timeout')

  // Regla 3 — el `AbortError` de Dexie llega acá, no al ignorado de arriba.
  if (name != null && STORAGE_ERROR_NAMES.has(name)) return classified('storage_failure')
  if (name === 'AbortError' && input.abortOrigin === 'dexie') return classified('storage_failure')

  // Regla 4 — deserialización fallida.
  if (name === 'SyntaxError') return classified('data_parse_failure')

  // Regla 5 — con `script-src 'self'` no hay terceros legítimos: son extensiones.
  if (isExtensionFilename(input.filename)) return classified('third_party_failure')

  // Regla 6 — sólo con señal explícita del envoltorio de red.
  if (input.networkFailureSignal === true) return classified('network_failure')

  // Regla 7 — fallback del boundary, no su etiqueta por defecto.
  if (input.source === 'react_boundary') return classified('render_failure')

  // Regla 8 — `unknown` mide la calidad del clasificador; no es un cajón.
  return classified('unknown')
}
