import { describe, expect, it, vi } from 'vitest'
import { loadReleaseManifest } from '../releaseManifestLoader'

function jsonResponse(body: unknown, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': contentType },
  })
}

const VALIDO = { formatVersion: 1, release: 'r1', assets: ['index-a1b2.js', 'state-c3d4.js'] }

describe('loadReleaseManifest — camino normal', () => {
  it('devuelve el inventario del release pedido', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(VALIDO))
    const assets = await loadReleaseManifest('r1', { fetchFn })

    expect(assets).toEqual(new Set(['index-a1b2.js', 'state-c3d4.js']))
  })

  it('pide el manifiesto de su propio release, sin query ni credenciales', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(VALIDO))
    await loadReleaseManifest('r1', { fetchFn })

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit | undefined]
    expect(url).toBe('/observability/releases/r1.json')
    expect(init?.credentials).toBe('omit')
  })
})

describe('loadReleaseManifest — degradaciones que dan null', () => {
  // El catch-all de netlify.toml sirve spa-fallback.html con status 200. Si
  // alguien le agregara `force`, esta ruta devolvería HTML, no un 404: mirar
  // sólo el status daría por bueno un documento que no es un manifiesto.
  it('rechaza una respuesta 200 que no es JSON', async () => {
    const fetchFn = vi.fn(
      async () => new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )
    expect(await loadReleaseManifest('r1', { fetchFn })).toBeNull()
  })

  it('rechaza un 404', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 404 }))
    expect(await loadReleaseManifest('r1', { fetchFn })).toBeNull()
  })

  it('rechaza un manifiesto de otro release', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ...VALIDO, release: 'otro' }))
    expect(await loadReleaseManifest('r1', { fetchFn })).toBeNull()
  })

  it('rechaza un manifiesto con contrato inválido', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ formatVersion: 99, release: 'r1', assets: [] }))
    expect(await loadReleaseManifest('r1', { fetchFn })).toBeNull()
  })

  it('rechaza un cuerpo que no es JSON parseable', async () => {
    const fetchFn = vi.fn(
      async () => new Response('{roto', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    expect(await loadReleaseManifest('r1', { fetchFn })).toBeNull()
  })

  // Un fallo de esta carga no se reporta recursivamente ni se propaga: el
  // reporter sigue funcionando, sólo que enviando categorías sin frames.
  it('no lanza cuando el fetch falla', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('sin red')
    })
    expect(await loadReleaseManifest('r1', { fetchFn })).toBeNull()
  })

  it('no consulta la red sin un release utilizable', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(VALIDO))
    expect(await loadReleaseManifest('', { fetchFn })).toBeNull()
    expect(await loadReleaseManifest('dev', { fetchFn })).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('rechaza un release con forma inválida sin consultar la red', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(VALIDO))
    expect(await loadReleaseManifest('../etc/passwd', { fetchFn })).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('acepta un manifiesto vacío como inventario vacío, no como ausencia', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ formatVersion: 1, release: 'r1', assets: [] }))
    expect(await loadReleaseManifest('r1', { fetchFn })).toEqual(new Set())
  })
})
