#!/usr/bin/env node
/**
 * Saca los sourcemaps de `dist` y los archiva por release.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §9.2.
 *
 * Los frames que persiste el reporter ubican `asset.js:línea:columna` del
 * bundle. Para llegar del bundle al código fuente hace falta el sourcemap — y
 * ese mapa **no puede ser público**: expone el código completo.
 *
 * `sourcemap: 'hidden'` en Vite quita el comentario `//# sourceMappingURL`, pero
 * **sigue escribiendo los `.map` dentro de `dist`**. Sin este paso quedarían
 * publicados y adivinables por nombre. Ocultar el comentario no es privacidad.
 *
 * Qué hace: mueve **todos** los `.map` de `dist` a `build-archive/<release>/`
 * junto con el manifiesto del release, y deja `dist` sin ninguno.
 *
 * **Apagado por defecto (`BUILD_SOURCEMAP_ARCHIVE`).** El destino privado no
 * está decidido (§9.2), y `build-archive/` vive sólo en el contenedor efímero
 * de Netlify: generar los mapas y moverlos ahí los **destruye** con el
 * contenedor, dejando la simbolización rota en vez de pendiente, y gastando
 * tiempo de build en el camino. Con la variable apagada, Vite tampoco los
 * genera. Se enciende junto con el paso de subida, no antes.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveReleaseId } from './generate-release-manifest.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const DIST_ASSETS = join(ROOT, 'dist', 'assets')
const DIST_MANIFESTS = join(ROOT, 'dist', 'observability', 'releases')
const ARCHIVE_ROOT = join(ROOT, 'build-archive')

const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Ordenado para que el archivo sea reproducible entre corridas. */
export function selectSourcemapFiles(files) {
  return files.filter((file) => file.endsWith('.map')).sort()
}

/**
 * Interruptor de generación y archivo. Fail-closed: sin destino donde subir los
 * mapas, la opción segura es no generarlos.
 */
export function isSourcemapArchiveEnabled(env) {
  const raw = env.BUILD_SOURCEMAP_ARCHIVE
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true'
}

/**
 * Recorre `dist` **entero**, no sólo `assets`. Vite puede emitir mapas de CSS
 * en la raíz, y una salida futura (workers, otro `output.dir`) los pondría en
 * otro lado: mirando un solo directorio, el build reportaría éxito mientras
 * publica un sourcemap.
 *
 * `readDir` e `isDir` se inyectan para poder probar el recorrido sin disco.
 */
export function collectSourcemapsRecursively(root, readDir, isDir) {
  const found = []
  const pending = [root]

  while (pending.length > 0) {
    const dir = pending.pop()
    for (const entry of readDir(dir)) {
      const full = `${dir}/${entry}`
      if (isDir(full)) pending.push(full)
      else if (entry.endsWith('.map')) found.push(full)
    }
  }

  return found
}

/** Un nombre con separadores o `..` escaparía del directorio del release. */
export function archivePathFor(release, file) {
  if (!RELEASE_ID.test(release)) {
    throw new Error(`Release inválido para archivar: ${release}`)
  }
  if (!BASENAME.test(file)) {
    throw new Error(`Nombre de mapa inválido: ${file}`)
  }
  return `${release}/${file}`
}

function main() {
  const release = resolveReleaseId(process.env)

  if (!existsSync(DIST_ASSETS)) {
    throw new Error('No existe dist/assets: hay que correr vite build antes.')
  }

  const distMaps = collectSourcemapsRecursively(
    join(ROOT, 'dist'),
    (dir) => readdirSync(dir),
    (path) => statSync(path).isDirectory(),
  )

  if (!isSourcemapArchiveEnabled(process.env)) {
    // Con el archivo apagado Vite no genera mapas. Si aparecieran igual, es un
    // sourcemap a punto de publicarse y hay que fallar, no seguir.
    if (distMaps.length > 0) {
      throw new Error(
        `Hay ${distMaps.length} sourcemaps en dist con BUILD_SOURCEMAP_ARCHIVE apagado.`,
      )
    }
    console.log('Sourcemaps: archivo desactivado (BUILD_SOURCEMAP_ARCHIVE).')
    return
  }

  const maps = selectSourcemapFiles(readdirSync(DIST_ASSETS))
  const target = join(ARCHIVE_ROOT, release)
  mkdirSync(target, { recursive: true })

  for (const file of maps) {
    const relative = archivePathFor(release, file)
    // `rename`, no `copy`: el mapa tiene que **dejar** de estar en dist.
    renameSync(join(DIST_ASSETS, file), join(ARCHIVE_ROOT, relative))
  }

  // El manifiesto viaja con los mapas: sin él no se sabe qué assets cubre.
  const manifest = join(DIST_MANIFESTS, `${release}.json`)
  if (existsSync(manifest)) {
    copyFileSync(manifest, join(target, 'release-manifest.json'))
  }

  writeFileSync(
    join(target, 'README.txt'),
    [
      `Release: ${release}`,
      `Mapas archivados: ${maps.length}`,
      '',
      'Contenido privado: estos .map reconstruyen el código fuente completo.',
      'No publicar. Subir a almacenamiento privado y conservar mientras el',
      'release siga distribuido, y al menos 30 dias despues de retirarlo.',
      '',
    ].join('\n'),
  )

  // El guard recorre `dist` completo, no sólo `assets`.
  const restantes = collectSourcemapsRecursively(
    join(ROOT, 'dist'),
    (dir) => readdirSync(dir),
    (path) => statSync(path).isDirectory(),
  )
  if (restantes.length > 0) {
    throw new Error(
      `Quedaron ${restantes.length} sourcemaps en dist: no se puede publicar. ${restantes.join(', ')}`,
    )
  }

  console.log(
    `Sourcemaps: ${maps.length} archivados en build-archive/${release} y removidos de dist.`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
