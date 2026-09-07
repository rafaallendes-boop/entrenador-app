import { describe, expect, it } from 'vitest'
import { AIProviderError } from '../../ai/types'
import type { AIErrorCode } from '../../ai/types'
import type { SyncErrorCategory } from '../../syncUtils'
import { DIAGNOSTIC_CODES } from '../clientErrorContract'
import { classifyClientError, readErrorName } from '../errorClassifier'

function namedError(name: string, message = 'da igual'): Error {
  const error = new Error(message)
  error.name = name
  return error
}

describe('classifyClientError — sync es entrada tipada, no heurística', () => {
  const casos: ReadonlyArray<[SyncErrorCategory, string]> = [
    ['schema_mismatch', 'sync_contract_failure'],
    ['validation_error', 'data_parse_failure'],
    ['duplicate_remote_profile', 'data_parse_failure'],
    ['network_error', 'network_failure'],
    ['auth_error', 'network_failure'],
    ['rls_error', 'network_failure'],
    ['supabase_not_configured', 'network_failure'],
    ['unknown_error', 'unknown'],
  ]

  it.each(casos)('mapea la categoría %s', (syncCategory, esperado) => {
    const resultado = classifyClientError({
      source: 'sync_failure',
      error: namedError('Error'),
      syncCategory,
    })
    expect(resultado).toEqual({ kind: 'classified', diagnosticCode: esperado })
  })

  it('cubre exhaustivamente las categorías de SyncErrorCategory', () => {
    const cubiertas = new Set(casos.map(([categoria]) => categoria))
    const declaradas: SyncErrorCategory[] = [
      'duplicate_remote_profile',
      'schema_mismatch',
      'network_error',
      'auth_error',
      'validation_error',
      'supabase_not_configured',
      'rls_error',
      'unknown_error',
    ]
    for (const categoria of declaradas) expect(cubiertas.has(categoria)).toBe(true)
  })

  it('sin categoría conocida no inventa: cae en unknown', () => {
    expect(
      classifyClientError({ source: 'sync_failure', error: namedError('Error') }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'unknown' })
  })
})

describe('classifyClientError — regla 0: AIProviderError manda', () => {
  const rechazos: AIErrorCode[] = [
    'entitlement_required',
    'coach_access_required',
    'quota_exceeded',
    'spend_cap_exceeded',
    'kill_switch_active',
    'rate_limit',
  ]

  it.each(rechazos)('ignora el rechazo de negocio %s', (code) => {
    const resultado = classifyClientError({
      source: 'unhandled_rejection',
      error: new AIProviderError('gemini', code, 'mensaje'),
    })
    expect(resultado).toEqual({ kind: 'ignored', reason: 'business_rejection' })
  })

  const mapeos: ReadonlyArray<[AIErrorCode, string]> = [
    ['timeout', 'timeout'],
    ['parse_error', 'data_parse_failure'],
    ['truncated', 'data_parse_failure'],
    ['server_error', 'network_failure'],
    ['misconfigured', 'network_failure'],
    ['unauthorized', 'network_failure'],
    ['unknown', 'unknown'],
  ]

  it.each(mapeos)('mapea el código %s', (code, esperado) => {
    const resultado = classifyClientError({
      source: 'unhandled_rejection',
      error: new AIProviderError('claude', code, 'mensaje'),
    })
    expect(resultado).toEqual({ kind: 'classified', diagnosticCode: esperado })
  })

  it('cubre exhaustivamente la unión AIErrorCode', () => {
    const cubiertos = new Set<string>([...rechazos, ...mapeos.map(([code]) => code)])
    const declarados: AIErrorCode[] = [
      'unauthorized', 'rate_limit', 'timeout', 'truncated', 'parse_error',
      'misconfigured', 'server_error', 'entitlement_required',
      'coach_access_required', 'quota_exceeded', 'spend_cap_exceeded',
      'kill_switch_active', 'unknown',
    ]
    expect(declarados).toHaveLength(13)
    for (const code of declarados) expect(cubiertos.has(code)).toBe(true)
  })

  // La regla 0 va primera porque no adivina: lee una unión tipada.
  it('gana sobre la inspección de forma dentro de un boundary', () => {
    const error = new AIProviderError('gemini', 'timeout', 'se acabó el tiempo')
    expect(classifyClientError({ source: 'react_boundary', error })).toEqual({
      kind: 'classified',
      diagnosticCode: 'timeout',
    })
  })
})

describe('classifyClientError — ignorados', () => {
  it('ignora un AbortError de fetch, que es cancelación deliberada', () => {
    const resultado = classifyClientError({
      source: 'unhandled_rejection',
      error: namedError('AbortError'),
      abortOrigin: 'fetch',
    })
    expect(resultado).toEqual({ kind: 'ignored', reason: 'deliberate_abort' })
  })

  it('ignora el loop de ResizeObserver', () => {
    const resultado = classifyClientError({
      source: 'window_error',
      error: null,
      message: 'ResizeObserver loop completed with undelivered notifications.',
    })
    expect(resultado).toEqual({ kind: 'ignored', reason: 'resize_observer_loop' })
  })

  it('ignora un Script error. sin filename, que es cross-origin no atribuible', () => {
    const resultado = classifyClientError({
      source: 'window_error',
      error: null,
      message: 'Script error.',
      filename: null,
    })
    expect(resultado).toEqual({ kind: 'ignored', reason: 'opaque_script_error' })
  })

  it('NO ignora un Script error. con filename de extensión', () => {
    const resultado = classifyClientError({
      source: 'window_error',
      error: null,
      message: 'Script error.',
      filename: 'chrome-extension://abcdef/content.js',
    })
    expect(resultado).toEqual({ kind: 'classified', diagnosticCode: 'third_party_failure' })
  })

  // El ignorado es por *no atribuible*, no por «no es una extensión». Un
  // Script error. con archivo propio sí se puede ubicar y no debe perderse.
  it('NO ignora un Script error. con filename propio', () => {
    const resultado = classifyClientError({
      source: 'window_error',
      error: null,
      message: 'Script error.',
      filename: 'https://app.rallyiq.cl/assets/index-a1b2c3.js',
    })
    expect(resultado).toEqual({ kind: 'classified', diagnosticCode: 'unknown' })
  })

  it('ignora un Script error. con filename vacío', () => {
    const resultado = classifyClientError({
      source: 'window_error',
      error: null,
      message: 'Script error.',
      filename: '',
    })
    expect(resultado).toEqual({ kind: 'ignored', reason: 'opaque_script_error' })
  })

  it('ignora un Script error. sin filename declarado', () => {
    const resultado = classifyClientError({
      source: 'window_error',
      error: null,
      message: 'Script error.',
    })
    expect(resultado).toEqual({ kind: 'ignored', reason: 'opaque_script_error' })
  })

  // Precedencia declarada en el spec: equivocarse acá pierde señal, no agrega ruido.
  it('NO ignora un AbortError de Dexie: es storage_failure', () => {
    const resultado = classifyClientError({
      source: 'unhandled_rejection',
      error: namedError('AbortError'),
      abortOrigin: 'dexie',
    })
    expect(resultado).toEqual({ kind: 'classified', diagnosticCode: 'storage_failure' })
  })

  it('NO ignora un AbortError de origen desconocido', () => {
    const resultado = classifyClientError({
      source: 'unhandled_rejection',
      error: namedError('AbortError'),
    })
    expect(resultado).toEqual({ kind: 'classified', diagnosticCode: 'unknown' })
  })
})

describe('classifyClientError — reglas de forma en orden fijo', () => {
  it('clasifica ChunkLoadError como chunk_load', () => {
    expect(
      classifyClientError({ source: 'window_error', error: namedError('ChunkLoadError') }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'chunk_load' })
  })

  it('clasifica una descarga fallida confirmada como chunk_load', () => {
    expect(
      classifyClientError({
        source: 'unhandled_rejection',
        error: namedError('TypeError'),
        chunkLoadSignal: true,
      }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'chunk_load' })
  })

  // `vite:preloadError` NO demuestra fallo de descarga: el helper de Vite hace
  // `baseModule().catch(handlePreloadError)`, así que el mismo evento se dispara
  // cuando el módulo se descargó bien y lanzó al evaluarse. Un bug de
  // inicialización no puede etiquetarse chunk_load.
  it('no presume chunk_load por un fallo de evaluación de módulo', () => {
    expect(
      classifyClientError({
        source: 'unhandled_rejection',
        error: namedError('TypeError', 'no se pudo leer x de undefined'),
        moduleLoadEventFired: true,
      }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'unknown' })
  })

  it('el evento de módulo tampoco fuerza chunk_load dentro de un boundary', () => {
    expect(
      classifyClientError({
        source: 'react_boundary',
        error: namedError('TypeError'),
        moduleLoadEventFired: true,
      }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'render_failure' })
  })

  it('el evento de módulo con descarga fallida confirmada sí es chunk_load', () => {
    expect(
      classifyClientError({
        source: 'unhandled_rejection',
        error: namedError('TypeError'),
        moduleLoadEventFired: true,
        chunkLoadSignal: true,
      }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'chunk_load' })
  })

  // «La causa gana sobre la superficie»: render_failure es el fallback del
  // boundary, no su etiqueta por defecto.
  it('un import fallido dentro del boundary es chunk_load, no render_failure', () => {
    expect(
      classifyClientError({
        source: 'react_boundary',
        error: namedError('ChunkLoadError'),
      }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'chunk_load' })
  })

  it('clasifica TimeoutError como timeout', () => {
    expect(
      classifyClientError({ source: 'unhandled_rejection', error: namedError('TimeoutError') }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'timeout' })
  })

  it.each([
    'QuotaExceededError',
    'DatabaseClosedError',
    'VersionError',
    'InvalidStateError',
    'TransactionInactiveError',
  ])('clasifica %s como storage_failure', (name) => {
    expect(
      classifyClientError({ source: 'unhandled_rejection', error: namedError(name) }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'storage_failure' })
  })

  it('clasifica SyntaxError como data_parse_failure', () => {
    expect(
      classifyClientError({ source: 'unhandled_rejection', error: namedError('SyntaxError') }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'data_parse_failure' })
  })

  it.each([
    'chrome-extension://abcdef/content.js',
    'moz-extension://abcdef/content.js',
    'safari-web-extension://abcdef/content.js',
  ])('clasifica un filename de extensión (%s) como third_party_failure', (filename) => {
    expect(
      classifyClientError({
        source: 'window_error',
        error: namedError('TypeError'),
        filename,
      }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'third_party_failure' })
  })

  it('clasifica una señal explícita de red como network_failure', () => {
    expect(
      classifyClientError({
        source: 'unhandled_rejection',
        error: namedError('TypeError'),
        networkFailureSignal: true,
      }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'network_failure' })
  })

  // Sin señal explícita, un TypeError pelado es el bug más común de JavaScript.
  // Llamarlo network_failure por su forma sería adivinar.
  it('un TypeError sin señal de red no se presume de red', () => {
    expect(
      classifyClientError({ source: 'window_error', error: namedError('TypeError') }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'unknown' })
  })

  it('usa render_failure como fallback del boundary', () => {
    expect(
      classifyClientError({ source: 'react_boundary', error: namedError('TypeError') }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'render_failure' })
  })

  it('cae en unknown cuando ninguna regla aplica', () => {
    expect(
      classifyClientError({ source: 'window_error', error: namedError('RangeError') }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'unknown' })
  })

  it('nunca emite un código fuera de la taxonomía cuando clasifica', () => {
    const entradas = [
      namedError('TypeError'), namedError('ChunkLoadError'), namedError('SyntaxError'),
      namedError('VersionError'), null, undefined, 'texto suelto', { raro: true },
    ]
    for (const error of entradas) {
      for (const source of ['window_error', 'unhandled_rejection', 'react_boundary'] as const) {
        const resultado = classifyClientError({ source, error })
        if (resultado.kind === 'classified') {
          expect(DIAGNOSTIC_CODES).toContain(resultado.diagnosticCode)
        }
      }
    }
  })
})

describe('classifyClientError — el clasificador nunca lanza', () => {
  /** Un valor de rechazo puede traer un getter hostil: leerlo rompería la captura. */
  function errorConNameHostil(): unknown {
    return {
      get name(): string {
        throw new Error('el getter de name lanza')
      },
    }
  }

  it('no lanza al inspeccionar un error con getter de name que lanza', () => {
    expect(() =>
      classifyClientError({ source: 'unhandled_rejection', error: errorConNameHostil() }),
    ).not.toThrow()
  })

  it('clasifica como unknown un error cuyo name no se puede leer', () => {
    expect(
      classifyClientError({ source: 'unhandled_rejection', error: errorConNameHostil() }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'unknown' })
  })

  it('conserva el fallback del boundary con un error hostil', () => {
    expect(
      classifyClientError({ source: 'react_boundary', error: errorConNameHostil() }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'render_failure' })
  })

  // Sync resuelve por categoría tipada: no hay razón para tocar el error crudo.
  it('resuelve sync sin inspeccionar el error', () => {
    const centinela = {
      get name(): string {
        throw new Error('no se debe leer en el camino de sync')
      },
    }
    expect(
      classifyClientError({
        source: 'sync_failure',
        error: centinela,
        syncCategory: 'schema_mismatch',
      }),
    ).toEqual({ kind: 'classified', diagnosticCode: 'sync_contract_failure' })
  })

  it('no lanza con un Proxy cuyo trap de prototipo falla', () => {
    const hostil = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('trap hostil')
        },
        get() {
          throw new Error('trap hostil')
        },
      },
    )
    expect(() =>
      classifyClientError({ source: 'window_error', error: hostil }),
    ).not.toThrow()
  })
})

describe('readErrorName', () => {
  it('lee el name de un Error', () => {
    expect(readErrorName(namedError('RangeError'))).toBe('RangeError')
  })

  // Un rechazo puede ser un objeto plano con `name`: el clasificador ya lo lee
  // para decidir, así que persistir otra cosa sería incoherente.
  it('lee el name de un objeto plano', () => {
    expect(readErrorName({ name: 'ChunkLoadError' })).toBe('ChunkLoadError')
  })

  it('devuelve null cuando no hay name legible', () => {
    expect(readErrorName(null)).toBeNull()
    expect(readErrorName('texto')).toBeNull()
    expect(readErrorName({ get name(): string { throw new Error('x') } })).toBeNull()
  })
})
