/**
 * Validación y construcción de la fila de `client_error_events`.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §7.
 *
 * El servidor **no confía en el cliente**. Tres invariantes que este módulo
 * sostiene y que conviene no relajar:
 *
 *  1. **La identidad la pone el servidor.** `user_id`, `id`, `fingerprint` y
 *     `created_at` nunca se aceptan del payload; un intento de atribuir el
 *     evento a otra cuenta se descarta en silencio, no se reporta como error.
 *  2. **Allowlist campo por campo.** Todo lo que no está declarado acá se
 *     descarta. Un `message` o un `stack` crudo enviado por un cliente viejo o
 *     manipulado no llega a la fila.
 *  3. **Normalizar no es rechazar.** `InvalidName`, `route = unknown` y
 *     `stack_frames = null` son resultados previstos: conservan el evento
 *     categórico en vez de perderlo. Sólo los conjuntos cerrados dan 400.
 *
 * `component` sí da 400 fuera de la allowlist —a diferencia de las tres
 * normalizaciones— porque es una etiqueta que escribimos nosotros al instrumentar:
 * si llega mal, es un bug de nuestro propio cableado y queremos verlo, no
 * degradarlo en silencio.
 */

import { createHash } from 'node:crypto'
import {
  isClientErrorComponent,
  isClientErrorPlatform,
  isClientErrorRequestClass,
  isClientErrorScopeKind,
  isClientErrorSource,
  isDiagnosticCode,
  type ClientErrorComponent,
  type ClientErrorPlatform,
  type ClientErrorRequestClass,
  type ClientErrorScopeKind,
  type ClientErrorSource,
  type DiagnosticCode,
} from '../../../src/services/observability/clientErrorContract'
import { normalizeErrorName } from '../../../src/services/observability/errorName'
import { normalizeRoute } from '../../../src/services/observability/routeNormalizer'
import {
  assetsForRelease,
  type ReleaseCatalog,
} from '../../../src/services/observability/releaseCatalog'
import { revalidateCanonicalFrames } from '../../../src/services/observability/stackFrames'

export const MAX_CLIENT_ERROR_PAYLOAD_BYTES = 8 * 1024

const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ClientErrorRow {
  readonly user_id: string
  readonly scope_kind: ClientErrorScopeKind
  readonly source: ClientErrorSource
  readonly diagnostic_code: DiagnosticCode
  readonly fingerprint: string
  readonly error_name: string
  readonly stack_frames: string | null
  readonly component: ClientErrorComponent | null
  readonly route: string
  readonly request_class: ClientErrorRequestClass | null
  readonly release: string
  readonly platform: ClientErrorPlatform
}

export type ClientErrorPayloadResult =
  | { readonly ok: true; readonly row: ClientErrorRow }
  | { readonly ok: false; readonly status: 400 | 413; readonly reason: string }

export interface BuildClientErrorRowInput {
  readonly rawBody: string
  readonly userId: string
  readonly catalog: ReleaseCatalog
}

function reject(status: 400 | 413, reason: string): ClientErrorPayloadResult {
  return { ok: false, status, reason }
}

/**
 * `sha256([error_name, diagnostic_code, component, route, primer_frame])`
 * truncado a 16 hex. Lo calcula el servidor: si lo calculara el cliente, dos
 * versiones del bundle podrían producir hashes distintos para el mismo error.
 *
 * Sólo entra el **primer** frame, para que la misma falla agrupe aunque cambie
 * la pila por debajo. No entra `user_id`: el fingerprint agrupa errores, no
 * cuentas.
 */
function computeFingerprint(parts: {
  errorName: string
  diagnosticCode: DiagnosticCode
  component: string | null
  route: string
  firstFrame: string | null
}): string {
  const tuple = JSON.stringify([
    parts.errorName,
    parts.diagnosticCode,
    parts.component,
    parts.route,
    parts.firstFrame,
  ])
  return createHash('sha256').update(tuple, 'utf8').digest('hex').slice(0, 16)
}

export function buildClientErrorRow(
  input: BuildClientErrorRowInput,
): ClientErrorPayloadResult {
  if (!UUID.test(input.userId)) return reject(400, 'user_id inválido')

  if (Buffer.byteLength(input.rawBody, 'utf8') > MAX_CLIENT_ERROR_PAYLOAD_BYTES) {
    return reject(413, 'payload demasiado grande')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input.rawBody) as unknown
  } catch {
    return reject(400, 'JSON inválido')
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return reject(400, 'el payload debe ser un objeto')
  }

  const body = parsed as Record<string, unknown>

  // Conjuntos cerrados: acá sí se rechaza.
  const source = body['source']
  if (!isClientErrorSource(source)) return reject(400, 'source inválido')

  const diagnosticCode = body['diagnostic_code']
  if (!isDiagnosticCode(diagnosticCode)) return reject(400, 'diagnostic_code inválido')

  const scopeKind = body['scope_kind']
  if (!isClientErrorScopeKind(scopeKind)) return reject(400, 'scope_kind inválido')

  const platform = body['platform']
  if (!isClientErrorPlatform(platform)) return reject(400, 'platform inválido')

  const release = body['release']
  if (typeof release !== 'string' || !RELEASE_ID.test(release)) {
    return reject(400, 'release inválido')
  }

  const rawRequestClass = body['request_class']
  let requestClass: ClientErrorRequestClass | null = null
  if (rawRequestClass !== undefined && rawRequestClass !== null) {
    if (!isClientErrorRequestClass(rawRequestClass)) return reject(400, 'request_class inválida')
    requestClass = rawRequestClass
  }

  const rawComponent = body['component']
  let component: ClientErrorComponent | null = null
  if (rawComponent !== undefined && rawComponent !== null) {
    if (!isClientErrorComponent(rawComponent)) return reject(400, 'component inválido')
    component = rawComponent
  }

  // Normalizaciones: nunca rechazan, conservan el evento categórico.
  const errorName = normalizeErrorName(body['error_name'])
  const route = normalizeRoute(body['route'])

  // El manifiesto es el del release **del evento**, no el del servidor: una
  // pestaña con bundle anterior conserva sus frames si ese release sigue soportado.
  const knownAssets = assetsForRelease(input.catalog, release)
  const stackFrames = revalidateCanonicalFrames(body['stack_frames'], knownAssets)

  const fingerprint = computeFingerprint({
    errorName,
    diagnosticCode,
    component,
    route,
    firstFrame: stackFrames === null ? null : (stackFrames.split('\n')[0] ?? null),
  })

  return {
    ok: true,
    row: {
      user_id: input.userId,
      scope_kind: scopeKind,
      source,
      diagnostic_code: diagnosticCode,
      fingerprint,
      error_name: errorName,
      stack_frames: stackFrames,
      component,
      route,
      request_class: requestClass,
      release,
      platform,
    },
  }
}
