import { describe, expect, it } from 'vitest'
import {
  archivePathFor,
  collectSourcemapsRecursively,
  isSourcemapArchiveEnabled,
  selectSourcemapFiles,
} from './archive-sourcemaps.mjs'

describe('selectSourcemapFiles', () => {
  it('selecciona sólo los .map', () => {
    expect(selectSourcemapFiles(['index-a1.js', 'index-a1.js.map', 'estilo.css', 'estilo.css.map']))
      .toEqual(['estilo.css.map', 'index-a1.js.map'])
  })

  it('devuelve lista vacía sin mapas', () => {
    expect(selectSourcemapFiles(['index-a1.js'])).toEqual([])
  })

  it('es determinista ante distinto orden de entrada', () => {
    expect(selectSourcemapFiles(['b.js.map', 'a.js.map'])).toEqual(
      selectSourcemapFiles(['a.js.map', 'b.js.map']),
    )
  })
})

describe('archivePathFor', () => {
  it('agrupa por release', () => {
    expect(archivePathFor('abc123', 'index-a1.js.map')).toBe('abc123/index-a1.js.map')
  })

  // Un nombre con separadores escaparía del directorio del release.
  it('rechaza un nombre que no es un basename', () => {
    expect(() => archivePathFor('abc123', '../fuera.map')).toThrow()
    expect(() => archivePathFor('abc123', 'sub/dir.map')).toThrow()
  })

  it('rechaza un release con forma inválida', () => {
    expect(() => archivePathFor('con espacios', 'a.js.map')).toThrow()
  })
})

describe('isSourcemapArchiveEnabled', () => {
  // Sin destino donde subirlos, generar mapas y moverlos a un directorio
  // efímero los destruye con el contenedor: la simbolización nacería rota en
  // vez de pendiente. Por eso la generación va apagada por defecto.
  it.each([
    ['ausente', {}],
    ['vacía', { BUILD_SOURCEMAP_ARCHIVE: '' }],
    ['false', { BUILD_SOURCEMAP_ARCHIVE: 'false' }],
    ['basura', { BUILD_SOURCEMAP_ARCHIVE: 'quizás' }],
  ])('está apagada con la variable %s', (_caso, env) => {
    expect(isSourcemapArchiveEnabled(env)).toBe(false)
  })

  it.each(['true', 'TRUE', ' true '])('se enciende con %s', (value) => {
    expect(isSourcemapArchiveEnabled({ BUILD_SOURCEMAP_ARCHIVE: value })).toBe(true)
  })
})

describe('collectSourcemapsRecursively', () => {
  // El guard sólo miraba dist/assets. Un .map en la raíz de dist —mapas de CSS,
  // o salida de un worker— no se archivaba ni se detectaba, y el build
  // reportaba éxito publicando un sourcemap.
  it('encuentra mapas fuera de assets', () => {
    const arbol = {
      'dist': ['assets', 'index.html', 'estilo.css.map'],
      'dist/assets': ['index-a1.js', 'index-a1.js.map'],
    }
    const encontrados = collectSourcemapsRecursively('dist', (dir) => arbol[dir] ?? [], (p) => p === 'dist/assets')
    expect(encontrados.sort()).toEqual(['dist/assets/index-a1.js.map', 'dist/estilo.css.map'])
  })

  it('devuelve vacío cuando no hay mapas', () => {
    const arbol = { 'dist': ['index.html'] }
    expect(collectSourcemapsRecursively('dist', (dir) => arbol[dir] ?? [], () => false)).toEqual([])
  })
})
