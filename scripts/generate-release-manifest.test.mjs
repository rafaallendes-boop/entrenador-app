import { describe, expect, it } from 'vitest'
import {
  buildManifestFromAssetFiles,
  mergeReleasesForCatalog,
  resolveReleaseId,
} from './generate-release-manifest.mjs'

describe('resolveReleaseId', () => {
  it('usa COMMIT_REF cuando existe', () => {
    expect(resolveReleaseId({ COMMIT_REF: 'a1b2c3d4' })).toBe('a1b2c3d4')
  })

  // Un build nativo no recibe COMMIT_REF: tiene que poder declarar el suyo.
  it('acepta un identificador explícito por encima de COMMIT_REF', () => {
    expect(resolveReleaseId({ COMMIT_REF: 'a1b2c3d4', APP_RELEASE: 'ios-1.4.0' })).toBe('ios-1.4.0')
  })

  it('cae en dev sin ninguna de las dos', () => {
    expect(resolveReleaseId({})).toBe('dev')
  })

  it('cae en dev ante un identificador con forma inválida', () => {
    expect(resolveReleaseId({ APP_RELEASE: 'con espacios' })).toBe('dev')
    expect(resolveReleaseId({ APP_RELEASE: 'x'.repeat(65) })).toBe('dev')
  })
})

describe('buildManifestFromAssetFiles', () => {
  it('conserva sólo los basenames JS, ordenados', () => {
    const manifest = buildManifestFromAssetFiles(
      ['state-c3d4.js', 'index-a1b2.js', 'estilos-e5f6.css', 'logo.svg'],
      'r1',
    )
    expect(manifest).toEqual({
      formatVersion: 1,
      release: 'r1',
      assets: ['index-a1b2.js', 'state-c3d4.js'],
    })
  })

  // Los .map nunca entran: el manifiesto es público y no debe insinuar
  // siquiera qué mapas existen.
  it('excluye los sourcemaps', () => {
    const manifest = buildManifestFromAssetFiles(['index-a1b2.js', 'index-a1b2.js.map'], 'r1')
    expect(manifest.assets).toEqual(['index-a1b2.js'])
  })

  it('produce un manifiesto válido para el parser del catálogo', async () => {
    const { parseReleaseManifest } = await import(
      '../src/services/observability/releaseCatalog.ts'
    )
    const manifest = buildManifestFromAssetFiles(['index-a1b2.js'], 'r1')
    expect(parseReleaseManifest(manifest)).not.toBeNull()
  })

  it('es determinista ante distinto orden de entrada', () => {
    const a = buildManifestFromAssetFiles(['b-2.js', 'a-1.js'], 'r1')
    const b = buildManifestFromAssetFiles(['a-1.js', 'b-2.js'], 'r1')
    expect(a).toEqual(b)
  })
})

describe('mergeReleasesForCatalog', () => {
  it('une manifiestos de releases reales', () => {
    const releases = mergeReleasesForCatalog([
      { formatVersion: 1, release: 'r1', assets: ['a-1.js'] },
      { formatVersion: 1, release: 'r2', assets: ['b-2.js'] },
    ])
    expect(releases).toEqual({ r1: ['a-1.js'], r2: ['b-2.js'] })
  })

  // El catálogo está versionado. Un build local resuelve `dev` y, si entrara,
  // dejaría el archivo sucio en cada corrida con 100+ nombres de assets
  // efímeros. Los tests inyectan su propio catálogo, así que no lo necesitan.
  it('deja fuera el release dev para no ensuciar el archivo versionado', () => {
    const releases = mergeReleasesForCatalog([
      { formatVersion: 1, release: 'dev', assets: ['efimero-1.js'] },
      { formatVersion: 1, release: 'r1', assets: ['a-1.js'] },
    ])
    expect(releases).toEqual({ r1: ['a-1.js'] })
  })

  it('rechaza el mismo release con inventario distinto', () => {
    expect(() =>
      mergeReleasesForCatalog([
        { formatVersion: 1, release: 'r1', assets: ['a-1.js'] },
        { formatVersion: 1, release: 'r1', assets: ['z-9.js'] },
      ]),
    ).toThrow(/dos inventarios distintos/)
  })

  it('tolera el mismo release repetido con inventario idéntico', () => {
    expect(
      mergeReleasesForCatalog([
        { formatVersion: 1, release: 'r1', assets: ['a-1.js', 'b-2.js'] },
        { formatVersion: 1, release: 'r1', assets: ['b-2.js', 'a-1.js'] },
      ]),
    ).toEqual({ r1: ['a-1.js', 'b-2.js'] })
  })
})
