import { describe, expect, it } from 'vitest'
import {
  MAX_STACK_FRAMES,
  normalizeStackFrames,
  revalidateCanonicalFrames,
} from '../stackFrames'

const ORIGINS: ReadonlySet<string> = new Set([
  'https://app.rallyiq.cl',
  'capacitor://localhost',
])

const ASSETS: ReadonlySet<string> = new Set([
  'index-a1b2c3.js',
  'state-d4e5f6.js',
  'PlanBuilderV2Page-99aa88.js',
])

describe('normalizeStackFrames — formatos de navegador', () => {
  it('extrae ubicaciones de un stack de Chromium y descarta nombres de función', () => {
    const stack = [
      'TypeError: no se pudo leer la sesión',
      '    at buildWeek (https://app.rallyiq.cl/assets/index-a1b2c3.js:14:22)',
      '    at https://app.rallyiq.cl/assets/state-d4e5f6.js:7:3',
    ].join('\n')

    expect(normalizeStackFrames(stack, ASSETS, ORIGINS)).toBe(
      'index-a1b2c3.js:14:22\nstate-d4e5f6.js:7:3',
    )
  })

  it('extrae ubicaciones del formato de Safari y Firefox', () => {
    const stack = [
      'buildWeek@https://app.rallyiq.cl/assets/index-a1b2c3.js:14:22',
      '@https://app.rallyiq.cl/assets/state-d4e5f6.js:7:3',
    ].join('\n')

    expect(normalizeStackFrames(stack, ASSETS, ORIGINS)).toBe(
      'index-a1b2c3.js:14:22\nstate-d4e5f6.js:7:3',
    )
  })

  // «No eliminar ciegamente el primer frame válido» (§5): un stack sin
  // encabezado empieza directamente en un frame y ese frame es el que importa.
  it('conserva el primer frame cuando el stack no trae encabezado', () => {
    const stack = 'at https://app.rallyiq.cl/assets/index-a1b2c3.js:14:22'
    expect(normalizeStackFrames(stack, ASSETS, ORIGINS)).toBe('index-a1b2c3.js:14:22')
  })

  it('acepta el esquema nativo de Capacitor', () => {
    const stack = '    at fn (capacitor://localhost/assets/index-a1b2c3.js:9:1)'
    expect(normalizeStackFrames(stack, ASSETS, ORIGINS)).toBe('index-a1b2c3.js:9:1')
  })

  it('descarta query y hash antes de validar la ubicación', () => {
    const stack = '    at fn (https://app.rallyiq.cl/assets/index-a1b2c3.js?v=4#x:14:22)'
    expect(normalizeStackFrames(stack, ASSETS, ORIGINS)).toBe('index-a1b2c3.js:14:22')
  })
})

describe('normalizeStackFrames — el manifiesto es la barrera', () => {
  it('descarta un asset que no está en el manifiesto', () => {
    const stack = '    at fn (https://app.rallyiq.cl/assets/desconocido-000.js:1:1)'
    expect(normalizeStackFrames(stack, ASSETS, ORIGINS)).toBeNull()
  })

  it('devuelve null cuando no hay manifiesto disponible', () => {
    const stack = '    at fn (https://app.rallyiq.cl/assets/index-a1b2c3.js:14:22)'
    expect(normalizeStackFrames(stack, null, ORIGINS)).toBeNull()
  })

  it('un manifiesto vacío no admite ningún asset', () => {
    const stack = '    at fn (https://app.rallyiq.cl/assets/index-a1b2c3.js:14:22)'
    expect(normalizeStackFrames(stack, new Set(), ORIGINS)).toBeNull()
  })

  // Éste es el caso que justifica el manifiesto frente a una gramática de
  // basename: un mensaje multilínea puede imitar un frame perfectamente formado.
  it('descarta un frame forjado dentro del mensaje del error', () => {
    const stack = [
      'Error: contacto rafa@example.com',
      '    at paso (https://app.rallyiq.cl/assets/MariaPerez.js:1:1)',
      '    at real (https://app.rallyiq.cl/assets/index-a1b2c3.js:14:22)',
    ].join('\n')

    expect(normalizeStackFrames(stack, ASSETS, ORIGINS)).toBe('index-a1b2c3.js:14:22')
  })
})

describe('normalizeStackFrames — orígenes y esquemas excluidos', () => {
  it.each([
    ['eval', '    at eval (eval at fn (https://app.rallyiq.cl/assets/index-a1b2c3.js:1:1), <anonymous>:1:1)'],
    ['data', '    at fn (data:text/javascript;base64,YWJj:1:1)'],
    ['blob', '    at fn (blob:https://app.rallyiq.cl/9f8e:1:1)'],
    ['extensión de Chrome', '    at fn (chrome-extension://abcdef/index-a1b2c3.js:1:1)'],
    ['extensión de Safari', '    at fn (safari-web-extension://abcdef/index-a1b2c3.js:1:1)'],
    ['path local', '    at fn (/Users/rafa/proyecto/src/index-a1b2c3.js:1:1)'],
    ['file://', '    at fn (file:///Users/rafa/index-a1b2c3.js:1:1)'],
    ['origen externo', '    at fn (https://cdn.evil.example/assets/index-a1b2c3.js:1:1)'],
  ])('descarta un frame de %s', (_caso, stack) => {
    expect(normalizeStackFrames(stack, ASSETS, ORIGINS)).toBeNull()
  })
})

describe('normalizeStackFrames — validación de posición', () => {
  it.each([
    ['línea cero', '    at fn (https://app.rallyiq.cl/assets/index-a1b2c3.js:0:5)'],
    ['columna cero', '    at fn (https://app.rallyiq.cl/assets/index-a1b2c3.js:5:0)'],
    ['línea negativa', '    at fn (https://app.rallyiq.cl/assets/index-a1b2c3.js:-3:5)'],
    ['posición no numérica', '    at fn (https://app.rallyiq.cl/assets/index-a1b2c3.js:a:b)'],
    ['sin posición', '    at fn (https://app.rallyiq.cl/assets/index-a1b2c3.js)'],
  ])('descarta un frame con %s', (_caso, stack) => {
    expect(normalizeStackFrames(stack, ASSETS, ORIGINS)).toBeNull()
  })
})

describe('normalizeStackFrames — límites y entradas degeneradas', () => {
  it(`recorta a ${MAX_STACK_FRAMES} frames`, () => {
    const stack = Array.from({ length: 25 }, (_v, i) =>
      `    at fn${i} (https://app.rallyiq.cl/assets/index-a1b2c3.js:${i + 1}:1)`,
    ).join('\n')

    const result = normalizeStackFrames(stack, ASSETS, ORIGINS)
    expect(result?.split('\n')).toHaveLength(MAX_STACK_FRAMES)
    expect(result?.split('\n')[0]).toBe('index-a1b2c3.js:1:1')
  })

  it('nunca supera los 2.000 caracteres', () => {
    const asset = 'PlanBuilderV2Page-99aa88.js'
    const stack = Array.from({ length: 25 }, (_v, i) =>
      `    at fn (https://app.rallyiq.cl/assets/${asset}:${i + 1}:999999)`,
    ).join('\n')

    const result = normalizeStackFrames(stack, ASSETS, ORIGINS)
    expect((result ?? '').length).toBeLessThanOrEqual(2000)
  })

  it('devuelve null si ningún frame es válido', () => {
    expect(normalizeStackFrames('Error: algo salió mal', ASSETS, ORIGINS)).toBeNull()
  })

  it('devuelve null para cualquier valor que no sea string', () => {
    expect(normalizeStackFrames(undefined, ASSETS, ORIGINS)).toBeNull()
    expect(normalizeStackFrames(null, ASSETS, ORIGINS)).toBeNull()
    expect(normalizeStackFrames({ stack: 'x' }, ASSETS, ORIGINS)).toBeNull()
  })

  it('no filtra ninguna palabra del mensaje en la salida', () => {
    const stack = [
      'TypeError: falló para rafa@example.com con id f47ac10b-58cc-4372-a567-0e02b2c3d479',
      '    at fn (https://app.rallyiq.cl/assets/index-a1b2c3.js:14:22)',
    ].join('\n')

    const result = normalizeStackFrames(stack, ASSETS, ORIGINS) ?? ''
    expect(result).toBe('index-a1b2c3.js:14:22')
    expect(result).not.toMatch(/rafa|example|f47ac10b|TypeError|falló/)
  })
})

describe('revalidateCanonicalFrames — segunda validación del servidor', () => {
  it('acepta líneas canónicas cuyos assets están en el manifiesto', () => {
    expect(revalidateCanonicalFrames('index-a1b2c3.js:14:22\nstate-d4e5f6.js:7:3', ASSETS))
      .toBe('index-a1b2c3.js:14:22\nstate-d4e5f6.js:7:3')
  })

  it('descarta una línea canónica con asset ausente del manifiesto', () => {
    expect(revalidateCanonicalFrames('desconocido-000.js:1:1', ASSETS)).toBeNull()
  })

  it('no confía en el cliente: descarta cualquier línea no canónica', () => {
    const forjado = 'index-a1b2c3.js:14:22 rafa@example.com'
    expect(revalidateCanonicalFrames(forjado, ASSETS)).toBeNull()
  })

  it('devuelve null sin manifiesto disponible', () => {
    expect(revalidateCanonicalFrames('index-a1b2c3.js:14:22', null)).toBeNull()
  })

  // El servidor revalida lo que el cliente ya normalizó: el resultado del
  // cliente tiene que atravesar el servidor sin cambiar.
  it('deja pasar sin cambios la salida del normalizador de cliente', () => {
    const stack = '    at fn (https://app.rallyiq.cl/assets/index-a1b2c3.js:14:22)'
    const cliente = normalizeStackFrames(stack, ASSETS, ORIGINS)
    expect(revalidateCanonicalFrames(cliente, ASSETS)).toBe(cliente)
  })
})
