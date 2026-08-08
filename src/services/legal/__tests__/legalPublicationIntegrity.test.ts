import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { CONSENT_DOCUMENTS, type ConsentPublication } from '../consentDocuments'

const VERSION_GRAMMAR = /^\d{4}-\d{2}-\d{2}(?:-r(?:[2-9]|[1-9]\d+))?$/

/**
 * Serialización canónica: incluye texto, `href` y marcas de énfasis, porque el
 * destino de un enlace es parte del compromiso legal y un hash de texto
 * colapsado lo perdería.
 */
function canonicalize(publication: ConsentPublication): string {
  return JSON.stringify(publication.content)
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Conjunto histórico congelado como tripleta `documento@versión#hash`.
 *
 * Congelar solo los ids no alcanza: alguien podría editar un artefacto viejo y
 * actualizar su `sha256` en el manifiesto, y los dos tests seguirían verdes —
 * el de hash porque coincide con el valor nuevo, y el de conjunto porque el id
 * no cambió. Con el hash dentro de la tripleta, esa edición rompe acá.
 *
 * Los hashes se completan junto con los del manifiesto al publicar el artefacto.
 */
const FROZEN_PUBLICATIONS = [
  'health@2026-06-20#153a93785d8d135962d9743553c1cfd15da471832f6efcdfa7cf6278be6e182e',
  'privacy@2026-07-13#d226efd919744ef32e46b17d74e1a35d651135919cef30316adb6162b77e560d',
  'privacy@2026-08-08#6541521b7b1d73bc3955aa3b592d4c2413ca2ab64eef679df9df535fb8bbb4aa',
  'terms@2026-07-13#b30dac62687b22e568b78d6c8f2f2be52da520020d0be2ce18e0adbafed1f20a',
  'whoop_biometric@2026-07-07#4dc98910c0d7df3ae7ed17a8df010856e8ed68c13bc3ddfe94549e5be3f7af98',
  'whoop_biometric@2026-08-08#29d1264f14f340d56a6fff4f7c5e8f7d02852b40c439572c506103c500ed1d3c',
]

describe('integridad de las publicaciones legales', () => {
  const all = CONSENT_DOCUMENTS.flatMap((document) =>
    document.publications.map((publication) => ({ document, publication })),
  )

  it('el conjunto histórico de publicaciones solo crece y su contenido no cambia', () => {
    expect(
      all
        .map(({ document, publication }) =>
          `${document.id}@${publication.version}#${publication.sha256}`,
        )
        .sort(),
    ).toEqual(FROZEN_PUBLICATIONS)
  })

  it.each(
    all.map(({ document, publication }) => [`${document.id}@${publication.version}`, publication] as const),
  )('%s conserva el hash de su contenido', (_label, publication) => {
    expect(sha256(canonicalize(publication))).toBe(publication.sha256)
  })

  it('cada versión respeta la gramática de identificador de publicación', () => {
    for (const { publication } of all) expect(publication.version).toMatch(VERSION_GRAMMAR)
  })

  it('ninguna versión se repite dentro de un documento', () => {
    for (const document of CONSENT_DOCUMENTS) {
      const versions = document.publications.map((publication) => publication.version)
      expect(new Set(versions).size).toBe(versions.length)
    }
  })

  it('la versión vigente de cada documento existe en su ledger', () => {
    for (const document of CONSENT_DOCUMENTS) {
      expect(document.publications.some((publication) => publication.version === document.currentVersion)).toBe(
        true,
      )
    }
  })
})
