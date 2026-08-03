import type { LegalDocumentContent } from './legalDocumentContent'
import { HEALTH_2026_06_20 } from './publications/health.2026-06-20'
import { PRIVACY_2026_07_13 } from './publications/privacy.2026-07-13'
import { TERMS_2026_07_13 } from './publications/terms.2026-07-13'
import { WHOOP_2026_07_07 } from './publications/whoop_biometric.2026-07-07'

export type ConsentDocumentId = 'terms' | 'privacy' | 'health' | 'whoop_biometric'

/** Documentos exigidos al entrar. `whoop_biometric` se pide en su propio punto. */
export const ENTRY_DOCUMENT_IDS: readonly ConsentDocumentId[] = ['terms', 'privacy', 'health']

export interface ConsentPublication {
  version: string
  sha256: string
  content: LegalDocumentContent
}

export interface ConsentDocument {
  id: ConsentDocumentId
  route: string
  currentVersion: string
  /** Append-only: toda publicación que existió, incluidas las retiradas. */
  publications: readonly ConsentPublication[]
}

export const CONSENT_DOCUMENTS: readonly ConsentDocument[] = [
  {
    id: 'terms',
    route: '/terms',
    currentVersion: '2026-07-13',
    publications: [
      {
        version: '2026-07-13',
        sha256: 'b30dac62687b22e568b78d6c8f2f2be52da520020d0be2ce18e0adbafed1f20a',
        content: TERMS_2026_07_13,
      },
    ],
  },
  {
    id: 'privacy',
    route: '/privacy',
    currentVersion: '2026-07-13',
    publications: [
      {
        version: '2026-07-13',
        sha256: 'd226efd919744ef32e46b17d74e1a35d651135919cef30316adb6162b77e560d',
        content: PRIVACY_2026_07_13,
      },
    ],
  },
  {
    id: 'health',
    route: '/health-disclaimer',
    currentVersion: '2026-06-20',
    publications: [
      {
        version: '2026-06-20',
        sha256: '153a93785d8d135962d9743553c1cfd15da471832f6efcdfa7cf6278be6e182e',
        content: HEALTH_2026_06_20,
      },
    ],
  },
  {
    id: 'whoop_biometric',
    route: '/whoop-disclaimer',
    currentVersion: '2026-07-07',
    publications: [
      {
        version: '2026-07-07',
        sha256: '4dc98910c0d7df3ae7ed17a8df010856e8ed68c13bc3ddfe94549e5be3f7af98',
        content: WHOOP_2026_07_07,
      },
    ],
  },
]

/** Ledger completo de publicaciones, incluida toda versión histórica. */
export const CONSENT_LEDGER = CONSENT_DOCUMENTS.flatMap((document) =>
  document.publications.map((publication) => ({
    document: document.id,
    ...publication,
  })),
)

export function getDocument(id: ConsentDocumentId): ConsentDocument {
  const found = CONSENT_DOCUMENTS.find((doc) => doc.id === id)
  if (!found) throw new Error(`Documento de consentimiento inexistente: ${id}`)
  return found
}

export function getCurrentVersion(id: ConsentDocumentId): string {
  return getDocument(id).currentVersion
}

export function getPublication(id: ConsentDocumentId, version: string): ConsentPublication {
  const found = getDocument(id).publications.find((publication) => publication.version === version)
  if (!found) throw new Error(`Publicación inexistente: ${id}@${version}`)
  return found
}
