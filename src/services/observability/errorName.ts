/**
 * Normalización de `error.name` para el reporter de errores de cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §5.
 *
 * Dos barreras en orden fijo. Primero la **forma**: `error.name` es una propiedad
 * escribible, así que nada impide que alguien le asigne un valor dinámico. El
 * regex acota largo y alfabeto, pero **no demuestra ausencia de contenido
 * personal** — `Rafael` y `a1b2c3d4` lo pasan. Por eso hay una segunda barrera:
 * la **allowlist** de clases que este repositorio conoce.
 *
 * Los dos fallbacks son distintos a propósito y no se deben colapsar:
 *   - `InvalidName`  → la forma falló. No prueba intención de forjar.
 *   - `UnlistedName` → la forma es admisible pero la clase no está reconocida.
 *     No prueba que sea una subclase legítima; puede ser un nombre dinámico
 *     bien formado.
 * Distinguirlos es lo que permite leer en el triage si el clasificador quedó
 * desactualizado o si alguien está escribiendo nombres dinámicos.
 *
 * El nombre original **nunca** viaja junto a `UnlistedName`.
 */

export const INVALID_ERROR_NAME = 'InvalidName'
export const UNLISTED_ERROR_NAME = 'UnlistedName'

/** Forma admisible: inicial alfabética, alfanumérico o `_`, máximo 64 caracteres. */
const ERROR_NAME_SHAPE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

/**
 * Clases conocidas. Ampliarla es sólo código —no toca el esquema— y es el camino
 * preferido para bajar `UnlistedName`, igual que la regla 5 de gobernanza de la
 * taxonomía de `diagnostic_code`.
 */
const KNOWN_ERROR_NAMES: ReadonlySet<string> = new Set([
  // Reservados: mantienen idempotente la normalización.
  INVALID_ERROR_NAME,
  UNLISTED_ERROR_NAME,

  // Nativos de JavaScript.
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AggregateError',

  // DOMException y familia web.
  'DOMException',
  'AbortError',
  'TimeoutError',
  'QuotaExceededError',
  'NotFoundError',
  'NotAllowedError',
  'SecurityError',
  'NetworkError',
  'InvalidStateError',
  'DataError',
  'DataCloneError',
  'ConstraintError',
  'VersionError',
  'TransactionInactiveError',
  'UnknownError',

  // Carga de chunks de Vite/Rollup.
  'ChunkLoadError',

  // Dexie.
  'DatabaseClosedError',
  'DexieError',
  'PrematureCommitError',
  'SchemaError',
  'UpgradeError',

  // Nombre declarado por integraciones que no producen un objeto de error.
  // Un fallo de sync llega sin `Error`, y persistirlo como `InvalidName` diría
  // «forma inválida» cuando en realidad no había forma que validar.
  'SyncError',

  // Clases propias del repositorio.
  'AIProviderError',
  'ApiUrlConfigurationError',
  'CoachAccessRequiredError',
  'EntitlementRequiredError',
  'KillSwitchActiveError',
  'MigrationPartialFailure',
  'OperationsAccessError',
  'PlanBuilderDailyQuotaError',
  'PlanEnqueueRejectedError',
  'SessionTemplateGoneError',
  'SpendCapExceededError',
  'UsageGateUnavailableError',
  'WeekCreatorSafeDecline',
  'WhoopApiError',
])

/**
 * Total y determinista: cualquier entrada produce uno de los nombres canónicos.
 * No recorta espacios — hacerlo aceptaría como válida una forma que no lo es.
 */
export function normalizeErrorName(rawName: unknown): string {
  if (typeof rawName !== 'string') return INVALID_ERROR_NAME
  if (!ERROR_NAME_SHAPE.test(rawName)) return INVALID_ERROR_NAME
  return KNOWN_ERROR_NAMES.has(rawName) ? rawName : UNLISTED_ERROR_NAME
}

/** Sólo para pruebas de contrato y para el guard de paridad cliente/servidor. */
export function knownErrorNamesSnapshot(): readonly string[] {
  return [...KNOWN_ERROR_NAMES].sort()
}
