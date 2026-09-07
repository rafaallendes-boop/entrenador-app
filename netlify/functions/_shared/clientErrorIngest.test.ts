import { describe, expect, it, vi } from 'vitest'
import { buildReleaseCatalog } from '../../../src/services/observability/releaseCatalog'
import {
  CLIENT_ERROR_RATE_LIMIT,
  CLIENT_ERROR_RATE_WINDOW_SECONDS,
  ingestClientError,
} from './clientErrorIngest'

const CATALOG = buildReleaseCatalog([
  { formatVersion: 1, release: 'r-actual', assets: ['index-a1b2c3.js'] },
])

const USER_ID = '11111111-1111-4111-8111-111111111111'

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    source: 'react_boundary',
    diagnostic_code: 'render_failure',
    scope_kind: 'self',
    error_name: 'TypeError',
    component: 'PlanBuilderV2',
    route: '/plans/builder',
    release: 'r-actual',
    platform: 'web',
    stack_frames: 'index-a1b2c3.js:14:22',
    ...overrides,
  })
}

function deps(overrides: Partial<Parameters<typeof ingestClientError>[1]> = {}) {
  return {
    callRpc: vi.fn(async () => [{ inserted: true, used: 1 }]),
    catalog: CATALOG,
    ingestionEnabled: true,
    ...overrides,
  }
}

describe('ingestClientError — camino normal', () => {
  it('inserta y reporta el resultado de la RPC', async () => {
    const d = deps()
    const outcome = await ingestClientError({ rawBody: payload(), userId: USER_ID }, d)

    expect(outcome).toEqual({ ok: true, inserted: true })
    expect(d.callRpc).toHaveBeenCalledTimes(1)
  })

  it('llama a la RPC de ingesta con el techo y la ventana declarados', async () => {
    const callRpc = vi.fn(async () => [{ inserted: true, used: 1 }])
    await ingestClientError({ rawBody: payload(), userId: USER_ID }, deps({ callRpc }))

    const [fnName, args] = callRpc.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(fnName).toBe('insert_client_error_event')
    expect(args['p_limit']).toBe(CLIENT_ERROR_RATE_LIMIT)
    expect(args['p_window_seconds']).toBe(CLIENT_ERROR_RATE_WINDOW_SECONDS)
    expect(args['p_user_id']).toBe(USER_ID)
    expect(args['p_fingerprint']).toMatch(/^[0-9a-f]{16}$/)
  })

  it('nunca manda al servidor un campo fuera de la allowlist', async () => {
    const callRpc = vi.fn(async () => [{ inserted: true, used: 1 }])
    await ingestClientError(
      { rawBody: payload({ message: 'rafa@example.com', stack: 'crudo' }), userId: USER_ID },
      deps({ callRpc }),
    )

    const [, args] = callRpc.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(JSON.stringify(args)).not.toMatch(/rafa|example|crudo/)
    expect(Object.keys(args).every((key) => key.startsWith('p_'))).toBe(true)
  })

  it('reporta sin insertar cuando la RPC dice que el techo está alcanzado', async () => {
    const d = deps({ callRpc: vi.fn(async () => [{ inserted: false, used: 30 }]) })
    const outcome = await ingestClientError({ rawBody: payload(), userId: USER_ID }, d)
    expect(outcome).toEqual({ ok: true, inserted: false })
  })
})

describe('ingestClientError — interruptor server-only', () => {
  // La flag VITE se resuelve en build y no apaga pestañas ya desplegadas.
  // Este interruptor es el que corta ingesta de esos clientes.
  it('no persiste ni llama a la RPC con la ingesta apagada', async () => {
    const d = deps({ ingestionEnabled: false })
    const outcome = await ingestClientError({ rawBody: payload(), userId: USER_ID }, d)

    expect(outcome).toEqual({ ok: true, inserted: false })
    expect(d.callRpc).not.toHaveBeenCalled()
  })
})

describe('ingestClientError — rechazos sin tocar la base', () => {
  it('rechaza contrato inválido con 400 y no llama a la RPC', async () => {
    const d = deps()
    const outcome = await ingestClientError(
      { rawBody: payload({ source: 'inventada' }), userId: USER_ID },
      d,
    )

    expect(outcome).toMatchObject({ ok: false, status: 400 })
    expect(d.callRpc).not.toHaveBeenCalled()
  })

  it('rechaza un cuerpo sobredimensionado con 413 y no llama a la RPC', async () => {
    const d = deps()
    const outcome = await ingestClientError(
      { rawBody: payload({ error_name: 'A'.repeat(9000) }), userId: USER_ID },
      d,
    )

    expect(outcome).toMatchObject({ ok: false, status: 413 })
    expect(d.callRpc).not.toHaveBeenCalled()
  })
})

describe('ingestClientError — fallo del control durable', () => {
  // «Si el control durable falla, no insertar por una vía alternativa.»
  it('no intenta un camino alternativo cuando la RPC falla', async () => {
    const callRpc = vi.fn(async () => {
      throw new Error('RPC caída')
    })
    const outcome = await ingestClientError({ rawBody: payload(), userId: USER_ID }, deps({ callRpc }))

    expect(outcome).toMatchObject({ ok: false, status: 503 })
    expect(callRpc).toHaveBeenCalledTimes(1)
  })

  it('no filtra el user_id ni el payload en el motivo del error', async () => {
    const callRpc = vi.fn(async () => {
      throw new Error(`fallo con ${USER_ID}`)
    })
    const outcome = await ingestClientError({ rawBody: payload(), userId: USER_ID }, deps({ callRpc }))

    if (outcome.ok) throw new Error('esperaba fallo')
    expect(outcome.reason).not.toContain(USER_ID)
  })

  it('trata una respuesta ilegible de la RPC como fallo, no como inserción', async () => {
    const d = deps({ callRpc: vi.fn(async () => 'respuesta rara') })
    const outcome = await ingestClientError({ rawBody: payload(), userId: USER_ID }, d)
    expect(outcome).toMatchObject({ ok: false, status: 503 })
  })
})

describe('ingestClientError — ningún bug interno se convierte en 500', () => {
  // Defensa en profundidad. `assetsForRelease` ya no lanza ante claves
  // heredadas, pero la ingesta no puede depender de que ninguna capa por debajo
  // lance nunca: un throw acá subía hasta el handler como 500 disparable por
  // cualquier cliente autenticado.
  it('no propaga un fallo de construcción de la fila', async () => {
    const catalogoHostil = {
      formatVersion: 1,
      get releases(): Record<string, readonly string[]> {
        throw new Error('catálogo corrupto')
      },
    }
    const d = deps({ catalog: catalogoHostil as never })

    const outcome = await ingestClientError({ rawBody: payload(), userId: USER_ID }, d)

    expect(outcome).toMatchObject({ ok: false, status: 400 })
    expect(d.callRpc).not.toHaveBeenCalled()
  })

  it('no propaga un fallo con un release que colisiona con el prototipo', async () => {
    const d = deps()
    for (const release of ['toString', 'constructor', 'valueOf']) {
      const outcome = await ingestClientError(
        { rawBody: payload({ release }), userId: USER_ID },
        d,
      )
      // Se acepta como evento categórico sin frames; nunca lanza.
      expect(outcome.ok).toBe(true)
    }
  })
})
