import { describe, expect, it } from 'vitest'
import {
  isClientErrorMetrics,
  rankClientErrorGroups,
  type ClientErrorGroup,
} from '../clientErrorMetricsContract'

function grupo(overrides: Partial<ClientErrorGroup> = {}): ClientErrorGroup {
  return {
    fingerprint: '0123456789abcdef',
    release: 'r1',
    source: 'window_error',
    diagnosticCode: 'unknown',
    errorName: 'TypeError',
    component: null,
    route: '/settings',
    count: 1,
    accounts: 1,
    firstSeen: '2026-09-01T00:00:00.000Z',
    lastSeen: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('rankClientErrorGroups — orden', () => {
  // El criterio del spec: ordenar por severidad ANTES de recortar el top, para
  // que un error grave de poco volumen no quede fuera por culpa de uno leve y
  // ruidoso.
  it('pone la severidad por encima del volumen', () => {
    const ranked = rankClientErrorGroups(
      [
        grupo({ fingerprint: 'ruidoso0ruidoso0', route: '/settings', count: 500 }),
        grupo({ fingerprint: 'grave000grave000', route: '/coach', count: 1 }),
      ],
      10,
    )

    expect(ranked[0]?.fingerprint).toBe('grave000grave000')
    expect(ranked[0]?.severity).toBe('alta')
    expect(ranked[1]?.severity).toBe('media')
  })

  it('no excluye un error grave de poco volumen al recortar el top', () => {
    const ruidosos = Array.from({ length: 15 }, (_v, i) =>
      grupo({ fingerprint: `ruidoso${String(i).padStart(9, '0')}`, count: 100 + i }),
    )
    const grave = grupo({ fingerprint: 'grave000grave000', route: '/coach', count: 1 })

    const ranked = rankClientErrorGroups([...ruidosos, grave], 10)

    expect(ranked).toHaveLength(10)
    expect(ranked.map((g) => g.fingerprint)).toContain('grave000grave000')
  })

  it('desempata por volumen dentro de la misma severidad', () => {
    const ranked = rankClientErrorGroups(
      [
        grupo({ fingerprint: 'poco0000poco0000', route: '/coach', count: 2 }),
        grupo({ fingerprint: 'mucho000mucho000', route: '/coach', count: 20 }),
      ],
      10,
    )
    expect(ranked.map((g) => g.fingerprint)).toEqual(['mucho000mucho000', 'poco0000poco0000'])
  })

  it('desempata por última aparición cuando severidad y volumen coinciden', () => {
    const ranked = rankClientErrorGroups(
      [
        grupo({ fingerprint: 'viejo000viejo000', lastSeen: '2026-09-01T00:00:00.000Z' }),
        grupo({ fingerprint: 'nuevo000nuevo000', lastSeen: '2026-09-05T00:00:00.000Z' }),
      ],
      10,
    )
    expect(ranked[0]?.fingerprint).toBe('nuevo000nuevo000')
  })

  it('deriva severidad con la misma función que el resto del sistema', () => {
    const ranked = rankClientErrorGroups(
      [
        grupo({ source: 'sync_failure', route: '/week' }),
        grupo({ fingerprint: 'baja0000baja0000', diagnosticCode: 'unknown', route: '/coaches' }),
      ],
      10,
    )
    expect(ranked[0]?.severity).toBe('alta')
    expect(ranked[1]?.severity).toBe('baja')
  })

  it('devuelve una lista vacía sin grupos', () => {
    expect(rankClientErrorGroups([], 10)).toEqual([])
  })

  it('no muta la lista de entrada', () => {
    const entrada = [grupo({ fingerprint: 'a'.repeat(16) }), grupo({ fingerprint: 'b'.repeat(16) })]
    const copia = [...entrada]
    rankClientErrorGroups(entrada, 1)
    expect(entrada).toEqual(copia)
  })
})

describe('isClientErrorMetrics', () => {
  const valido = {
    status: 'ready',
    windows: {
      day: { groups: [], unknown: { total: 0, share: 0, breakdown: [] }, total: 0 },
      week: { groups: [], unknown: { total: 0, share: 0, breakdown: [] }, total: 0 },
    },
    retention: { status: 'ok', expiredRemaining: 0, oldestExpiredAt: null, checkedAt: '2026-09-07T00:00:00.000Z' },
  }

  it('acepta un contrato completo', () => {
    expect(isClientErrorMetrics(valido)).toBe(true)
  })

  // Los tres estados son distintos a propósito: cero eventos no es lo mismo que
  // tabla ausente, y ninguno de los dos es lo mismo que un fallo de consulta.
  it.each(['ready', 'not_installed', 'unavailable'])('acepta el estado %s', (status) => {
    expect(isClientErrorMetrics({ ...valido, status })).toBe(true)
  })

  it.each([
    ['null', null],
    ['un string', 'x'],
    ['sin status', { windows: valido.windows }],
    ['status inventado', { ...valido, status: 'quizás' }],
    ['sin windows en ready', { status: 'ready', retention: valido.retention }],
  ])('rechaza %s', (_caso, value) => {
    expect(isClientErrorMetrics(value)).toBe(false)
  })
})
