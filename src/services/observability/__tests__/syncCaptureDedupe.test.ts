import { describe, expect, it, vi } from 'vitest'
import { createClientErrorReporter } from '../clientErrorReporter'
import { classifyClientError } from '../errorClassifier'
import { captureSyncFailure } from '../syncErrorCapture'
import type { CaptureContext } from '../installClientErrorReporter'

/**
 * Integración de las tres piezas de sync sin tocar el navegador: puente →
 * clasificador → reporter. Es el criterio de aceptación de B3 que pide que una
 * falla terminal sintética produzca exactamente una fila.
 */
function armarCadena() {
  const transport = vi.fn(async () => 204)
  const reporter = createClientErrorReporter({
    transport,
    now: () => 0,
    enabled: true,
    currentAccountId: () => 'cuenta-a',
    release: 'r1',
    platform: 'web',
  })

  const capture = (context: CaptureContext): void => {
    const outcome = classifyClientError({
      source: context.source,
      error: context.error,
      syncCategory: context.syncCategory ?? null,
    })
    if (outcome.kind === 'ignored') return
    void reporter.report({
      source: context.source,
      diagnosticCode: outcome.diagnosticCode,
      scopeKind: 'self',
      errorName: 'Error',
      component: context.component ?? null,
      route: '/week',
      stackFrames: null,
      requestClass: null,
    })
  }

  return { transport, capture }
}

describe('sync: una falla terminal produce una sola fila', () => {
  it('envía una vez una falla terminal aislada', async () => {
    const { transport, capture } = armarCadena()
    captureSyncFailure('upsertRow:non_retriable', { category: 'schema_mismatch' }, capture)
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1))
  })

  // La misma falla puede registrarse en la fila y otra vez al abortar el sync
  // completo. Son dos eventos de `syncLog` para un solo problema.
  it('no duplica cuando la misma falla se registra al subir de capa', async () => {
    const { transport, capture } = armarCadena()
    captureSyncFailure('upsertRow:non_retriable', { category: 'schema_mismatch' }, capture)
    captureSyncFailure('runFullSync:non_retriable', { category: 'schema_mismatch' }, capture)

    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1))
  })

  it('sí distingue dos fallas de categorías distintas', async () => {
    const { transport, capture } = armarCadena()
    captureSyncFailure('upsertRow:non_retriable', { category: 'schema_mismatch' }, capture)
    captureSyncFailure('upsertRow:non_retriable', { category: 'rls_error' }, capture)

    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2))
  })
})
