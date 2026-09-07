import { describe, expect, it, vi } from 'vitest'
import { captureSyncFailure } from '../syncErrorCapture'

describe('captureSyncFailure', () => {
  // Sólo los tres eventos terminales. Reportar cada 409 reintentable o cada
  // corte de red inundaría el canal con estados normales de la cola.
  it.each([
    'upsertRow:non_retriable',
    'deleteRow:non_retriable',
    'runFullSync:non_retriable',
  ])('captura el evento terminal %s', (event) => {
    const capture = vi.fn()
    captureSyncFailure(event, { category: 'schema_mismatch' }, capture)

    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0]![0]).toMatchObject({
      source: 'sync_failure',
      syncCategory: 'schema_mismatch',
      component: 'SyncService',
    })
  })

  it.each([
    'upsertRow:retry',
    'runFullSync:start',
    'upsertRow:athlete_tombstoned_skip',
    'queue:op_failed',
  ])('ignora el evento no terminal %s', (event) => {
    const capture = vi.fn()
    captureSyncFailure(event, { category: 'network_error' }, capture)
    expect(capture).not.toHaveBeenCalled()
  })

  // «Nunca transmitir `details` de syncLog»: trae tabla, ids y fragmentos de
  // fila. Sólo la categoría tipada cruza.
  it('no transmite los details de syncLog', () => {
    const capture = vi.fn()
    captureSyncFailure(
      'upsertRow:non_retriable',
      {
        category: 'validation_error',
        table: 'sessions',
        rowId: 'sesion-de-rafa',
        email: 'rafa@example.com',
      },
      capture,
    )

    const payload = JSON.stringify(capture.mock.calls[0]![0])
    expect(payload).not.toMatch(/sessions|rafa|example/)
  })

  it('no captura sin una categoría reconocible', () => {
    const capture = vi.fn()
    captureSyncFailure('upsertRow:non_retriable', { category: 'inventada' }, capture)
    expect(capture).not.toHaveBeenCalled()
  })

  it('no captura si falta la categoría', () => {
    const capture = vi.fn()
    captureSyncFailure('upsertRow:non_retriable', {}, capture)
    expect(capture).not.toHaveBeenCalled()
  })

  it('nunca lanza aunque la captura falle', () => {
    const capture = vi.fn(() => {
      throw new Error('el reporter falló')
    })
    expect(() =>
      captureSyncFailure('upsertRow:non_retriable', { category: 'rls_error' }, capture),
    ).not.toThrow()
  })
})

describe('captureSyncFailure — nombre del error', () => {
  // Sin este nombre explícito, un fallo de sync viaja con `error: null` y se
  // persiste como `InvalidName`, que por contrato significa «la forma falló».
  // El triage leería cada fallo de contrato de sync como un nombre forjado.
  it('declara un nombre propio en vez de dejar InvalidName', () => {
    const capture = vi.fn()
    captureSyncFailure('upsertRow:non_retriable', { category: 'schema_mismatch' }, capture)

    expect(capture.mock.calls[0]![0]).toMatchObject({ errorName: 'SyncError' })
  })
})
