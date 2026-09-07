import { describe, expect, it } from 'vitest'
import { buildReleaseCatalog } from '../../../src/services/observability/releaseCatalog'
import { MAX_CLIENT_ERROR_PAYLOAD_BYTES, buildClientErrorRow } from './clientErrorPayload'

const CATALOG = buildReleaseCatalog([
  { formatVersion: 1, release: 'r-actual', assets: ['index-a1b2c3.js', 'state-d4e5f6.js'] },
  { formatVersion: 1, release: 'r-anterior', assets: ['index-viejo00.js'] },
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

function buildOk(body: string) {
  const result = buildClientErrorRow({ rawBody: body, userId: USER_ID, catalog: CATALOG })
  if (!result.ok) throw new Error(`esperaba ok, llegó ${result.status}: ${result.reason}`)
  return result.row
}

describe('buildClientErrorRow — camino feliz', () => {
  it('construye la fila con los campos allowlisted', () => {
    const row = buildOk(payload())
    expect(row).toMatchObject({
      user_id: USER_ID,
      source: 'react_boundary',
      diagnostic_code: 'render_failure',
      scope_kind: 'self',
      error_name: 'TypeError',
      component: 'PlanBuilderV2',
      route: '/plans/builder',
      release: 'r-actual',
      platform: 'web',
      stack_frames: 'index-a1b2c3.js:14:22',
    })
  })

  it('acepta request_class ausente como null', () => {
    expect(buildOk(payload()).request_class).toBeNull()
  })

  it('acepta una request_class conocida', () => {
    expect(buildOk(payload({ request_class: 'chat_action' })).request_class).toBe('chat_action')
  })
})

describe('buildClientErrorRow — la identidad la pone el servidor', () => {
  it('ignora un user_id del payload y usa el de la sesión', () => {
    const otro = '22222222-2222-4222-8222-222222222222'
    expect(buildOk(payload({ user_id: otro })).user_id).toBe(USER_ID)
  })

  it('ignora id, fingerprint y created_at del payload', () => {
    const row = buildOk(
      payload({ id: 999, fingerprint: 'forjado0forjado0', created_at: '1999-01-01T00:00:00Z' }),
    )
    expect(row).not.toHaveProperty('id')
    expect(row.fingerprint).not.toBe('forjado0forjado0')
    expect(row).not.toHaveProperty('created_at')
  })

  it('descarta cualquier campo extra', () => {
    const row = buildOk(payload({ message: 'rafa@example.com', stack: 'crudo', extra: 1 }))
    expect(JSON.stringify(row)).not.toMatch(/rafa|example|crudo/)
  })
})

describe('buildClientErrorRow — normalizaciones que NO son 400', () => {
  it('normaliza un error_name inválido a InvalidName', () => {
    expect(buildOk(payload({ error_name: 'Error: rafa@example.com' })).error_name).toBe(
      'InvalidName',
    )
  })

  it('normaliza un error_name no listado a UnlistedName', () => {
    expect(buildOk(payload({ error_name: 'AlgoQueNadieDeclaro' })).error_name).toBe('UnlistedName')
  })

  it('normaliza una ruta desconocida a unknown', () => {
    expect(buildOk(payload({ route: '/inventada' })).route).toBe('unknown')
  })

  it('normaliza el patrón de día y descarta el dato', () => {
    expect(buildOk(payload({ route: '/day/2026-08-23' })).route).toBe('/day/:date')
  })

  it('deja stack_frames en null si el asset no está en el manifiesto del release', () => {
    expect(buildOk(payload({ stack_frames: 'desconocido-000.js:1:1' })).stack_frames).toBeNull()
  })

  it('deja stack_frames en null si el release no tiene manifiesto', () => {
    const row = buildOk(payload({ release: 'r-jamas-publicado' }))
    expect(row.release).toBe('r-jamas-publicado')
    expect(row.stack_frames).toBeNull()
  })

  it('admite frames del release anterior con su propio inventario', () => {
    const row = buildOk(
      payload({ release: 'r-anterior', stack_frames: 'index-viejo00.js:3:9' }),
    )
    expect(row.stack_frames).toBe('index-viejo00.js:3:9')
  })

  it('no admite un asset de otro release', () => {
    const row = buildOk(payload({ release: 'r-anterior', stack_frames: 'index-a1b2c3.js:1:1' }))
    expect(row.stack_frames).toBeNull()
  })

  it('descarta una línea de frames no canónica sin rechazar el evento', () => {
    const row = buildOk(payload({ stack_frames: 'index-a1b2c3.js:14:22 rafa@example.com' }))
    expect(row.stack_frames).toBeNull()
  })
})

describe('buildClientErrorRow — rechazos', () => {
  it('rechaza un cuerpo sobre el límite con 413', () => {
    const grande = payload({ error_name: 'A'.repeat(MAX_CLIENT_ERROR_PAYLOAD_BYTES) })
    const result = buildClientErrorRow({ rawBody: grande, userId: USER_ID, catalog: CATALOG })
    expect(result).toMatchObject({ ok: false, status: 413 })
  })

  it.each([
    ['JSON inválido', '{no es json'],
    ['cuerpo vacío', ''],
    ['array en vez de objeto', '[]'],
    ['null', 'null'],
  ])('rechaza %s con 400', (_caso, body) => {
    expect(buildClientErrorRow({ rawBody: body, userId: USER_ID, catalog: CATALOG }))
      .toMatchObject({ ok: false, status: 400 })
  })

  it.each([
    ['source', { source: 'inventada' }],
    ['source ausente', { source: undefined }],
    ['diagnostic_code', { diagnostic_code: 'inventado' }],
    ['scope_kind', { scope_kind: 'coach' }],
    ['platform', { platform: 'android' }],
    ['release vacío', { release: '' }],
    ['release con espacios', { release: 'r actual' }],
    ['request_class desconocida', { request_class: 'inventada' }],
    ['component fuera de la allowlist', { component: 'CualquierCosa' }],
    ['component con componentStack crudo', { component: '    at Foo (index.js:1:1)' }],
  ])('rechaza %s con 400', (_caso, overrides) => {
    const result = buildClientErrorRow({
      rawBody: payload(overrides),
      userId: USER_ID,
      catalog: CATALOG,
    })
    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('acepta component ausente como null', () => {
    expect(buildOk(payload({ component: undefined })).component).toBeNull()
  })

  it('rechaza un userId que no es UUID', () => {
    expect(buildClientErrorRow({ rawBody: payload(), userId: 'no-uuid', catalog: CATALOG }))
      .toMatchObject({ ok: false, status: 400 })
  })
})

describe('buildClientErrorRow — fingerprint', () => {
  it('es de 16 caracteres hexadecimales', () => {
    expect(buildOk(payload()).fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('es estable para la misma tupla', () => {
    expect(buildOk(payload()).fingerprint).toBe(buildOk(payload()).fingerprint)
  })

  it.each([
    ['la ruta', { route: '/coach' }],
    ['el diagnostic_code', { diagnostic_code: 'unknown' }],
    ['el error_name', { error_name: 'RangeError' }],
    ['el componente', { component: 'CoachWorkspace' }],
    ['el primer frame', { stack_frames: 'state-d4e5f6.js:1:1' }],
  ])('cambia cuando cambia %s', (_caso, overrides) => {
    expect(buildOk(payload(overrides)).fingerprint).not.toBe(buildOk(payload()).fingerprint)
  })

  // Sólo el primer frame entra en la tupla: agrupa el mismo error aunque la
  // pila de llamadas por debajo cambie entre ocurrencias.
  it('no cambia cuando cambian los frames posteriores al primero', () => {
    const a = buildOk(payload({ stack_frames: 'index-a1b2c3.js:14:22\nstate-d4e5f6.js:7:3' }))
    const b = buildOk(payload({ stack_frames: 'index-a1b2c3.js:14:22' }))
    expect(a.fingerprint).toBe(b.fingerprint)
  })

  it('no depende del user_id: agrupa el mismo error entre cuentas', () => {
    const otro = '22222222-2222-4222-8222-222222222222'
    const a = buildClientErrorRow({ rawBody: payload(), userId: USER_ID, catalog: CATALOG })
    const b = buildClientErrorRow({ rawBody: payload(), userId: otro, catalog: CATALOG })
    if (!a.ok || !b.ok) throw new Error('esperaba ok')
    expect(a.row.fingerprint).toBe(b.row.fingerprint)
  })
})
