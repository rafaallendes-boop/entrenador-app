/**
 * Catálogo de manifiestos de release.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §9.1.
 *
 * Un manifiesto declara qué basenames JS publicó un release. Es **metadato de
 * assets publicados**: no lleva rutas locales, ni fuentes, ni mapas, ni
 * credenciales, ni nada de usuarios. Los archivos que nombra ya son visibles en
 * la red de cualquier visitante.
 *
 * La pertenencia al catálogo es la barrera real de `normalizeStackFrames`: una
 * gramática de basename aceptaría `MariaPerez.js`, y estar autenticado no
 * convierte ese texto en una ubicación de código conocida.
 *
 * El catálogo se genera en build y la función lo importa **estáticamente**: en
 * tiempo de request no hay red, ni almacenamiento privado, ni credenciales.
 * Cubre el release actual y los anteriores todavía soportados, para que una
 * pestaña con bundle viejo —justo la población que produce `chunk_load` tras un
 * deploy— no pierda sus frames.
 */

export const RELEASE_MANIFEST_FORMAT_VERSION = 1

/** Basename de un asset JS publicado. Sin ruta, esquema, query ni hash. */
const ASSET_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.js$/

/** Identificador de build: `COMMIT_REF`, un tag, o un identificador nativo. */
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export class ReleaseCatalogError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReleaseCatalogError'
  }
}

export interface ReleaseManifest {
  readonly formatVersion: number
  readonly release: string
  readonly assets: readonly string[]
}

export interface ReleaseCatalog {
  readonly formatVersion: number
  readonly releases: Readonly<Record<string, readonly string[]>>
}

/**
 * Valida un manifiesto leído de disco o de la red. Total: devuelve `null` ante
 * cualquier desvío en vez de lanzar, para que un archivo corrupto degrade a
 * «sin manifiesto» y no rompa el build ni la request.
 */
export function parseReleaseManifest(value: unknown): ReleaseManifest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const candidate = value as Record<string, unknown>
  if (candidate['formatVersion'] !== RELEASE_MANIFEST_FORMAT_VERSION) return null

  const release = candidate['release']
  if (typeof release !== 'string' || !RELEASE_ID.test(release)) return null

  const assets = candidate['assets']
  if (!Array.isArray(assets)) return null

  const normalized: string[] = []
  for (const asset of assets) {
    if (typeof asset !== 'string' || !ASSET_BASENAME.test(asset)) return null
    // Un basename repetido dentro del mismo release es ambiguo: dos archivos
    // distintos no pueden compartir nombre en un mismo inventario.
    if (normalized.includes(asset)) return null
    normalized.push(asset)
  }

  return { formatVersion: RELEASE_MANIFEST_FORMAT_VERSION, release, assets: normalized }
}

function sameInventory(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((asset, index) => asset === sortedB[index])
}

/**
 * Une manifiestos en el catálogo que se empaqueta con la función.
 *
 * Lanza ante el mismo release con inventario distinto: significa que un build
 * se publicó dos veces con contenido diferente, y a partir de ahí el catálogo
 * no puede decidir qué frame es legítimo. Es preferible fallar en build.
 */
export function buildReleaseCatalog(
  manifests: readonly ReleaseManifest[],
): ReleaseCatalog {
  // Sin prototipo: `RELEASE_ID` acepta `toString`, `constructor` y `valueOf`,
  // y sobre un objeto literal esas claves resolverían a funciones heredadas en
  // vez de a `undefined`.
  const releases: Record<string, readonly string[]> = Object.create(null) as Record<
    string,
    readonly string[]
  >

  for (const manifest of manifests) {
    const previous = ownAssets(releases, manifest.release)
    if (previous !== undefined) {
      if (!sameInventory(previous, manifest.assets)) {
        throw new ReleaseCatalogError(
          `El release ${manifest.release} aparece con dos inventarios distintos.`,
        )
      }
      continue
    }
    releases[manifest.release] = [...manifest.assets]
  }

  return { formatVersion: RELEASE_MANIFEST_FORMAT_VERSION, releases }
}

/**
 * Lookup seguro. El catálogo llega de `JSON.parse`, así que su prototipo es
 * `Object.prototype`: sin esta comprobación, un release llamado `toString`
 * devolvería una función heredada y `new Set(fn)` lanzaría — un throw que sube
 * hasta el handler y convierte un 400 en un 500 disparable por cualquier
 * cliente autenticado.
 */
function ownAssets(
  releases: Readonly<Record<string, readonly string[]>>,
  release: string,
): readonly string[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(releases, release)) return undefined
  const assets = releases[release]
  return Array.isArray(assets) ? assets : undefined
}

/**
 * Assets admitidos para el release **del evento**, no el del servidor.
 * `null` significa manifiesto no disponible, que `normalizeStackFrames`
 * resuelve conservando las categorías con `stack_frames` en null.
 */
export function assetsForRelease(
  catalog: ReleaseCatalog,
  release: string | null | undefined,
): ReadonlySet<string> | null {
  if (typeof release !== 'string' || release === '') return null
  const assets = ownAssets(catalog.releases, release)
  return assets === undefined ? null : new Set(assets)
}
