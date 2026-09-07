import { describe, expect, it } from 'vitest'
import { resolveBrowserScopeKind } from '../browserScope'

describe('resolveBrowserScopeKind', () => {
  it('marca managed cuando ambos ids están resueltos y son distintos', () => {
    expect(resolveBrowserScopeKind('atleta-gestionado', 'yo-mismo')).toBe('managed')
  })

  it('marca self cuando ambos ids son iguales', () => {
    expect(resolveBrowserScopeKind('yo-mismo', 'yo-mismo')).toBe('self')
  })

  // Este self de arranque significa «contexto de cuenta por defecto». No
  // demuestra que la operación haya afectado un atleta self, y no habilita
  // lectura ni adopción de filas legacy: es sólo una convención de telemetría.
  it.each([
    ['activo sin resolver', null, 'yo-mismo'],
    ['self sin resolver', 'atleta-gestionado', null],
    ['ninguno resuelto', null, null],
    ['activo indefinido', undefined, 'yo-mismo'],
    ['cadena vacía', '', 'yo-mismo'],
  ])('marca self cuando %s', (_caso, active, self) => {
    expect(resolveBrowserScopeKind(active, self)).toBe('self')
  })

  it('no pierde el evento por falta de hidratación', () => {
    expect(resolveBrowserScopeKind(null, null)).toBe('self')
  })

  it('es determinista', () => {
    expect(resolveBrowserScopeKind('a', 'b')).toBe(resolveBrowserScopeKind('a', 'b'))
  })
})
