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
    // 6 = 4 documentos + las dos publicaciones de zonas de FC, registradas y NO
    // vigentes. El largo crece cada vez que se registra una publicación nueva;
    // lo que no puede moverse sin decisión explícita es `currentVersion`.
    expect(CONSENT_LEDGER).toHaveLength(6)
    expect(getCurrentVersion('health')).toBe('2026-06-20')
    expect(getPublication('terms', '2026-07-13')).toBe(getDocument('terms').publications[0])
  })

  it('las publicaciones de zonas de FC quedan registradas pero NO vigentes', () => {
    // Activarlas es el Deploy 2 del rollout, después de la aprobación jurídica,
    // y detiene la sincronización de Whoop para quien no reacepte. Que este test
    // se ponga rojo significa que alguien adelantó ese paso.
    expect(getCurrentVersion('privacy')).toBe('2026-07-13')
    expect(getCurrentVersion('whoop_biometric')).toBe('2026-07-07')
    expect(getPublication('privacy', '2026-08-08')).toBeDefined()
    expect(getPublication('whoop_biometric', '2026-08-08')).toBeDefined()
  })

  it('rechaza documentos y publicaciones inexistentes', () => {
    expect(() => getDocument('missing' as never)).toThrow('Documento de consentimiento inexistente: missing')
    expect(() => getPublication('privacy', '2000-01-01')).toThrow(
      'Publicación inexistente: privacy@2000-01-01',
    )
  })
})
