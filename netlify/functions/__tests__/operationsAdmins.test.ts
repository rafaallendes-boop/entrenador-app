import { describe, expect, it } from 'vitest'
import { isOperationsAdmin } from '../_shared/operationsAdmins'

const UUID_A = '11111111-2222-4333-8444-555555555555'
const UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function env(value?: string): NodeJS.ProcessEnv {
  return (value === undefined ? {} : { OPERATIONS_ADMIN_USER_IDS: value }) as NodeJS.ProcessEnv
}

describe('isOperationsAdmin', () => {
  it('sin variable definida NADIE es admin', () => {
    expect(isOperationsAdmin(UUID_A, env())).toBe(false)
  })

  it('variable vacia o solo separadores: nadie', () => {
    expect(isOperationsAdmin(UUID_A, env(''))).toBe(false)
    expect(isOperationsAdmin(UUID_A, env('  , ,  '))).toBe(false)
  })

  it('acepta un uuid listado', () => {
    expect(isOperationsAdmin(UUID_A, env(UUID_A))).toBe(true)
  })

  it('acepta listas con espacios y varios uuid', () => {
    expect(isOperationsAdmin(UUID_B, env(`${UUID_A} , ${UUID_B}`))).toBe(true)
  })

  it('rechaza un uuid no listado', () => {
    expect(isOperationsAdmin(UUID_B, env(UUID_A))).toBe(false)
  })

  it('compara sin distinguir mayusculas', () => {
    // UUID_A no tiene letras hexadecimales (a-f), asi que toUpperCase() es un no-op
    // sobre el: usar UUID_B en las dos direcciones para que el fixture realmente
    // ejercite el case-folding de .toLowerCase() en ambos lados de la comparacion.
    expect(isOperationsAdmin(UUID_B.toUpperCase(), env(UUID_B))).toBe(true)
    expect(isOperationsAdmin(UUID_B, env(UUID_B.toUpperCase()))).toBe(true)
  })

  it('un userId que no es UUID nunca autoriza, ni aunque figure literal en la lista', () => {
    expect(isOperationsAdmin('rafa@example.com', env('rafa@example.com'))).toBe(false)
  })

  it('una entrada basura no invalida las demas', () => {
    expect(isOperationsAdmin(UUID_A, env(`no-es-uuid, ${UUID_A}`))).toBe(true)
  })

  it('userId vacio nunca autoriza, ni con lista basura', () => {
    expect(isOperationsAdmin('', env('no-es-uuid'))).toBe(false)
    expect(isOperationsAdmin('', env(''))).toBe(false)
  })
})
