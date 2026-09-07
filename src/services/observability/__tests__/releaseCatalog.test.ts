import { describe, expect, it } from 'vitest'
import {
  RELEASE_MANIFEST_FORMAT_VERSION,
  ReleaseCatalogError,
  assetsForRelease,
  buildReleaseCatalog,
  parseReleaseManifest,
} from '../releaseCatalog'

function manifest(release: string, assets: string[]): unknown {
  return { formatVersion: RELEASE_MANIFEST_FORMAT_VERSION, release, assets }
}

describe('parseReleaseManifest', () => {
  it('acepta un manifiesto bien formado', () => {
    expect(parseReleaseManifest(manifest('abc1234', ['index-a1b2.js', 'state-c3d4.js']))).toEqual({
      formatVersion: RELEASE_MANIFEST_FORMAT_VERSION,
      release: 'abc1234',
      assets: ['index-a1b2.js', 'state-c3d4.js'],
    })
  })

  it.each([
    ['null', null],
    ['un string', 'no soy un manifiesto'],
    ['un array', []],
    ['sin release', { formatVersion: 1, assets: [] }],
    ['sin assets', { formatVersion: 1, release: 'abc' }],
    ['assets que no es lista', { formatVersion: 1, release: 'abc', assets: 'index.js' }],
    ['formatVersion desconocido', { formatVersion: 99, release: 'abc', assets: [] }],
    ['release vacío', { formatVersion: 1, release: '', assets: [] }],
  ])('rechaza %s', (_caso, value) => {
    expect(parseReleaseManifest(value)).toBeNull()
  })

  // Los assets son basenames de `dist/assets`. Cualquier cosa con ruta,
  // esquema o query no es un basename y no debe entrar al catálogo.
  it.each([
    'assets/index-a1b2.js',
    '../index-a1b2.js',
    'https://app.rallyiq.cl/assets/index-a1b2.js',
    'index-a1b2.js?v=1',
    'index-a1b2.js#x',
    '',
    'index-a1b2.map',
  ])('rechaza el manifiesto si un asset no es un basename JS (%s)', (asset) => {
    expect(parseReleaseManifest(manifest('abc', [asset]))).toBeNull()
  })

  it('rechaza basenames ambiguos dentro del mismo release', () => {
    expect(parseReleaseManifest(manifest('abc', ['index-a1b2.js', 'index-a1b2.js']))).toBeNull()
  })

  it('no acepta un release con caracteres fuera del identificador de build', () => {
    expect(parseReleaseManifest(manifest('abc 123', ['index-a1b2.js']))).toBeNull()
    expect(parseReleaseManifest(manifest('a'.repeat(65), ['index-a1b2.js']))).toBeNull()
  })
})

describe('buildReleaseCatalog', () => {
  it('une manifiestos de varios releases', () => {
    const catalogo = buildReleaseCatalog([
      { formatVersion: 1, release: 'r1', assets: ['index-aaa.js'] },
      { formatVersion: 1, release: 'r2', assets: ['index-bbb.js', 'state-ccc.js'] },
    ])

    expect(assetsForRelease(catalogo, 'r1')).toEqual(new Set(['index-aaa.js']))
    expect(assetsForRelease(catalogo, 'r2')).toEqual(new Set(['index-bbb.js', 'state-ccc.js']))
  })

  it('tolera el mismo release repetido con inventario idéntico', () => {
    const catalogo = buildReleaseCatalog([
      { formatVersion: 1, release: 'r1', assets: ['index-aaa.js', 'state-bbb.js'] },
      { formatVersion: 1, release: 'r1', assets: ['state-bbb.js', 'index-aaa.js'] },
    ])
    expect(assetsForRelease(catalogo, 'r1')).toEqual(new Set(['index-aaa.js', 'state-bbb.js']))
  })

  // Dos inventarios distintos con el mismo nombre de release significan que un
  // build se publicó dos veces con contenido diferente: el catálogo dejaría de
  // poder validar frames y hay que fallar en build, no en producción.
  it('rechaza el mismo release con inventario distinto', () => {
    expect(() =>
      buildReleaseCatalog([
        { formatVersion: 1, release: 'r1', assets: ['index-aaa.js'] },
        { formatVersion: 1, release: 'r1', assets: ['index-zzz.js'] },
      ]),
    ).toThrow(ReleaseCatalogError)
  })

  it('acepta un catálogo vacío', () => {
    expect(assetsForRelease(buildReleaseCatalog([]), 'r1')).toBeNull()
  })
})

describe('assetsForRelease', () => {
  const catalogo = buildReleaseCatalog([
    { formatVersion: 1, release: 'actual', assets: ['index-nuevo.js'] },
    { formatVersion: 1, release: 'anterior', assets: ['index-viejo.js'] },
  ])

  it('admite frames del release actual y del anterior', () => {
    expect(assetsForRelease(catalogo, 'actual')?.has('index-nuevo.js')).toBe(true)
    expect(assetsForRelease(catalogo, 'anterior')?.has('index-viejo.js')).toBe(true)
  })

  it('no mezcla inventarios entre releases', () => {
    expect(assetsForRelease(catalogo, 'actual')?.has('index-viejo.js')).toBe(false)
  })

  // «Release sin manifiesto disponible conserva las categorías, con frames null»:
  // null es lo que `normalizeStackFrames` interpreta como manifiesto ausente.
  it('devuelve null para un release desconocido', () => {
    expect(assetsForRelease(catalogo, 'jamas-publicado')).toBeNull()
  })

  it('devuelve null para un release no string', () => {
    expect(assetsForRelease(catalogo, undefined)).toBeNull()
    expect(assetsForRelease(catalogo, null)).toBeNull()
  })
})

describe('assetsForRelease — claves heredadas del prototipo', () => {
  const catalogo = buildReleaseCatalog([
    { formatVersion: 1, release: 'r1', assets: ['index-aaa.js'] },
  ])

  // `RELEASE_ID` acepta `toString`, `constructor` y `valueOf`, así que un
  // lookup por índice sobre un objeto de JSON.parse devolvería la función del
  // prototipo en vez de `undefined`. `new Set(fn)` lanza, y ese throw sube
  // hasta el handler y convierte un 400 en un 500.
  it.each(['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'devuelve null para la clave heredada %s',
    (clave) => {
      expect(assetsForRelease(catalogo, clave)).toBeNull()
    },
  )

  it('no lanza para ninguna clave heredada', () => {
    for (const clave of ['toString', 'constructor', 'valueOf', '__proto__']) {
      expect(() => assetsForRelease(catalogo, clave)).not.toThrow()
    }
  })
})

describe('buildReleaseCatalog — claves heredadas', () => {
  it('no confunde un release llamado toString con una colisión de inventario', () => {
    const catalogo = buildReleaseCatalog([
      { formatVersion: 1, release: 'toString', assets: ['index-aaa.js'] },
    ])
    expect(assetsForRelease(catalogo, 'toString')).toEqual(new Set(['index-aaa.js']))
  })
})
