#!/usr/bin/env node
/**
 * Genera el manifiesto del release actual y el catálogo que la función de
 * ingesta importa estáticamente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §9.1.
 *
 * Qué produce:
 *   1. `dist/observability/releases/<release>.json` — manifiesto público del
 *      build actual, más una copia de cada release histórico soportado. El
 *      cliente carga el suyo una vez para poder normalizar frames.
 *   2. `netlify/functions/_shared/generatedReleaseCatalog.json` — catálogo
 *      unido (actual + históricos) que la función importa. En tiempo de request
 *      no hay red, ni almacenamiento privado, ni credenciales.
 *
 * Corre **antes** de empaquetar las Functions, dentro de `npm run build`.
 *
 * Los manifiestos históricos viven revisados en `observability/release-manifests/`
 * y son metadatos de assets publicados: nombres de archivo que cualquier
 * visitante ya ve en la red. Sin rutas locales, fuentes, mapas ni credenciales.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const DIST_ASSETS = join(ROOT, 'dist', 'assets')
const DIST_MANIFESTS = join(ROOT, 'dist', 'observability', 'releases')
const HISTORICAL_MANIFESTS = join(ROOT, 'observability', 'release-manifests')
const GENERATED_CATALOG = join(
  ROOT,
  'netlify',
  'functions',
  '_shared',
  'generatedReleaseCatalog.json',
)

const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const ASSET_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.js$/

/**
 * `APP_RELEASE` gana sobre `COMMIT_REF`: un build nativo no recibe la variable
 * de Netlify y tiene que poder declarar su propio identificador trazable.
 * Un identificador con forma inválida cae en `dev` en vez de propagarse.
 */
export function resolveReleaseId(env) {
  const explicit = typeof env.APP_RELEASE === 'string' ? env.APP_RELEASE.trim() : ''
  if (explicit !== '') return RELEASE_ID.test(explicit) ? explicit : 'dev'

  const commitRef = typeof env.COMMIT_REF === 'string' ? env.COMMIT_REF.trim() : ''
  if (commitRef !== '') return RELEASE_ID.test(commitRef) ? commitRef : 'dev'

  return 'dev'
}

/** Sólo basenames JS del build. Los `.map` quedan fuera a propósito. */
export function buildManifestFromAssetFiles(files, release) {
  const assets = [...new Set(files.filter((file) => ASSET_BASENAME.test(file)))].sort()
  return { formatVersion: 1, release, assets }
}

function readHistoricalManifests() {
  if (!existsSync(HISTORICAL_MANIFESTS)) return []

  return readdirSync(HISTORICAL_MANIFESTS)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const raw = readFileSync(join(HISTORICAL_MANIFESTS, file), 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed?.formatVersion !== 1 || !RELEASE_ID.test(String(parsed?.release ?? ''))) {
        throw new Error(`Manifiesto histórico inválido: ${file}`)
      }
      return parsed
    })
}

/**
 * Une manifiestos en el mapa que se empaqueta con la función.
 *
 * `dev` queda **fuera**: el catálogo está versionado y un build local dejaría
 * el archivo sucio en cada corrida con 100+ nombres de assets efímeros. Los
 * tests inyectan su propio catálogo, así que no dependen de esto.
 */
export function mergeReleasesForCatalog(manifests) {
  // Sin prototipo: un release llamado `toString` resolvería a la función
  // heredada en vez de a `undefined` y el merge se confundiría.
  const releases = Object.create(null)
  for (const manifest of manifests) {
    if (manifest.release === 'dev') continue
    const previous = Object.prototype.hasOwnProperty.call(releases, manifest.release)
      ? releases[manifest.release]
      : undefined
    if (previous !== undefined) {
      // Dos inventarios con el mismo nombre de release significan que un build
      // se publicó dos veces con contenido distinto. A partir de ahí el catálogo
      // no puede decidir qué frame es legítimo: mejor fallar en build.
      if (!sameInventory(previous, manifest.assets)) {
        throw new Error(
          `El release ${manifest.release} aparece con dos inventarios distintos.`,
        )
      }
      // Inventario equivalente: se conserva el primero, para que el catálogo no
      // dependa del orden en que se leyeron los manifiestos.
      continue
    }
    releases[manifest.release] = manifest.assets
  }
  return releases
}

function sameInventory(a, b) {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((asset, index) => asset === sortedB[index])
}

function main() {
  const release = resolveReleaseId(process.env)

  if (!existsSync(DIST_ASSETS)) {
    throw new Error('No existe dist/assets: hay que correr vite build antes.')
  }

  const current = buildManifestFromAssetFiles(readdirSync(DIST_ASSETS), release)
  const manifests = [...readHistoricalManifests(), current]

  const releases = mergeReleasesForCatalog(manifests)

  // Los manifiestos publicados sí incluyen el build actual, `dev` incluido:
  // son lo que el cliente carga para su propio release.
  const published = Object.fromEntries(
    manifests.map((manifest) => [manifest.release, manifest.assets]),
  )

  mkdirSync(DIST_MANIFESTS, { recursive: true })
  for (const [releaseId, assets] of Object.entries(published)) {
    writeFileSync(
      join(DIST_MANIFESTS, `${releaseId}.json`),
      `${JSON.stringify({ formatVersion: 1, release: releaseId, assets }, null, 2)}\n`,
    )
  }

  writeFileSync(
    GENERATED_CATALOG,
    `${JSON.stringify({ formatVersion: 1, releases }, null, 2)}\n`,
  )

  // Un deploy real siempre trae COMMIT_REF. Si resolvió `dev` en producción, el
  // catálogo queda sin ese release y TODOS los frames llegarían null: es una
  // degradación silenciosa, así que se dice fuerte.
  if (release === 'dev') {
    console.warn(
      'Release manifest: release resuelto como `dev`. No entra al catálogo; ' +
        'en un deploy real esto significa frames nulos. Definir COMMIT_REF o APP_RELEASE.',
    )
  }

  console.log(
    `Release manifest: ${release} (${current.assets.length} assets, ` +
      `${Object.keys(releases).length} releases en el catálogo)`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
