import { describe, expect, it } from 'vitest'

import {
  CONSENT_DOCUMENTS,
  CONSENT_LEDGER,
  ENTRY_DOCUMENT_IDS,
  getCurrentVersion,
  getDocument,
  getPublication,
} from '../consentDocuments'

describe('consentDocuments', () => {
  it('declara las rutas y versiones vigentes de los cuatro documentos', () => {
    expect(
      CONSENT_DOCUMENTS.map(({ id, route, currentVersion }) => ({ id, route, currentVersion })),
    ).toEqual([
      { id: 'terms', route: '/terms', currentVersion: '2026-07-13' },
      { id: 'privacy', route: '/privacy', currentVersion: '2026-07-13' },
      { id: 'health', route: '/health-disclaimer', currentVersion: '2026-06-20' },
      { id: 'whoop_biometric', route: '/whoop-disclaimer', currentVersion: '2026-07-07' },
    ])
  })

  it('separa Whoop de los documentos exigidos al entrar', () => {
    expect(ENTRY_DOCUMENT_IDS).toEqual(['terms', 'privacy', 'health'])
  })

  it('expone el ledger y resuelve publicaciones vigentes', () => {
    expect(CONSENT_LEDGER).toHaveLength(4)
    expect(getCurrentVersion('health')).toBe('2026-06-20')
    expect(getPublication('terms', '2026-07-13')).toBe(getDocument('terms').publications[0])
  })

  it('rechaza documentos y publicaciones inexistentes', () => {
    expect(() => getDocument('missing' as never)).toThrow('Documento de consentimiento inexistente: missing')
    expect(() => getPublication('privacy', '2000-01-01')).toThrow(
      'Publicación inexistente: privacy@2000-01-01',
    )
  })
})
