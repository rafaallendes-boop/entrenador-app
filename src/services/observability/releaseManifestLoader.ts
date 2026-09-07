/**
 * Carga del manifiesto del propio release, en el cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §9.1.
 *
 * Sin manifiesto, `normalizeStackFrames` devuelve `null` y el evento viaja
 * igual, sólo que categórico. Por eso esta carga **nunca lanza, nunca reintenta
 * y nunca demora el arranque de la app**: su peor caso es perder los frames, no
 * perder el error.
 *
 * Un fallo de esta carga tampoco se reporta recursivamente — sería el camino
 * más corto a una tormenta de eventos sobre el propio canal de errores.
 *
 * Se valida `content-type`, no sólo el status: el catch-all de `netlify.toml`
 * sirve `spa-fallback.html` con **200**. Hoy no intercepta esta ruta porque esa
 * regla no lleva `force` y un archivo real gana, pero si alguien se lo agregara,
 * mirar sólo el status daría por bueno un documento HTML.
 */

import { parseReleaseManifest } from './releaseCatalog'

const MANIFEST_TIMEOUT_MS = 3_000
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export interface LoadReleaseManifestDeps {
  readonly fetchFn: typeof fetch
  readonly timeoutMs?: number
}

/**
 * Devuelve el inventario de assets del release, o `null` si no se pudo
 * establecer. Un manifiesto vacío es un inventario vacío —que no admite ningún
 * frame— y **no** es lo mismo que la ausencia de manifiesto.
 */
export async function loadReleaseManifest(
  release: string,
  deps: LoadReleaseManifestDeps,
): Promise<ReadonlySet<string> | null> {
  // `dev` no se publica al catálogo del servidor, así que pedirlo sólo gastaría
  // una request cuyo resultado el servidor iba a descartar igual.
  if (typeof release !== 'string' || release === '' || release === 'dev') return null
  if (!RELEASE_ID.test(release)) return null

  let response: Response
  try {
    response = await deps.fetchFn(`/observability/releases/${release}.json`, {
      method: 'GET',
      credentials: 'omit',
      signal: AbortSignal.timeout(deps.timeoutMs ?? MANIFEST_TIMEOUT_MS),
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) return null

  let body: unknown
  try {
    body = (await response.json()) as unknown
  } catch {
    return null
  }

  const manifest = parseReleaseManifest(body)
  if (manifest === null) return null

  // Un manifiesto que dice pertenecer a otro release no sirve para validar
  // frames de éste, aunque haya llegado por la URL correcta.
  if (manifest.release !== release) return null

  return new Set(manifest.assets)
}
