import { describe, expect, it } from 'vitest'
import {
  INVALID_ERROR_NAME,
  UNLISTED_ERROR_NAME,
  normalizeErrorName,
} from '../errorName'

describe('normalizeErrorName', () => {
  it('conserva un nombre nativo de la allowlist', () => {
    expect(normalizeErrorName('TypeError')).toBe('TypeError')
  })

  it('conserva un nombre de error propio de la app', () => {
    expect(normalizeErrorName('AIProviderError')).toBe('AIProviderError')
  })

  it('marca UnlistedName una forma válida que no está en la allowlist', () => {
    expect(normalizeErrorName('AlgoQueNadieDeclaro')).toBe(UNLISTED_ERROR_NAME)
  })

  it('marca InvalidName un nombre que falla el regex de forma', () => {
    expect(normalizeErrorName('Error: no encontrado rafa@example.com')).toBe(
      INVALID_ERROR_NAME,
    )
  })

  it('marca InvalidName un UUID, porque los guiones no pasan la forma', () => {
    expect(normalizeErrorName('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(
      INVALID_ERROR_NAME,
    )
  })

  it('marca InvalidName un nombre que empieza con dígito', () => {
    expect(normalizeErrorName('1Error')).toBe(INVALID_ERROR_NAME)
  })

  it('marca InvalidName un nombre de más de 64 caracteres', () => {
    expect(normalizeErrorName('A'.repeat(65))).toBe(INVALID_ERROR_NAME)
  })

  it('acepta exactamente 64 caracteres como forma válida', () => {
    expect(normalizeErrorName('A'.repeat(64))).toBe(UNLISTED_ERROR_NAME)
  })

  it('marca InvalidName cualquier valor que no sea string', () => {
    expect(normalizeErrorName(undefined)).toBe(INVALID_ERROR_NAME)
    expect(normalizeErrorName(null)).toBe(INVALID_ERROR_NAME)
    expect(normalizeErrorName({ name: 'TypeError' })).toBe(INVALID_ERROR_NAME)
    expect(normalizeErrorName(42)).toBe(INVALID_ERROR_NAME)
  })

  it('no recorta ni transforma: un nombre con espacios alrededor es inválido', () => {
    expect(normalizeErrorName(' TypeError ')).toBe(INVALID_ERROR_NAME)
  })

  // Los dos fallbacks son valores canónicos reservados (§5 del spec): si no
  // fueran estables, normalizar dos veces convertiría InvalidName en
  // UnlistedName y el triage dejaría de poder distinguirlos.
  it('es idempotente sobre sus propios fallbacks', () => {
    expect(normalizeErrorName(INVALID_ERROR_NAME)).toBe(INVALID_ERROR_NAME)
    expect(normalizeErrorName(UNLISTED_ERROR_NAME)).toBe(UNLISTED_ERROR_NAME)
  })

  it('es idempotente sobre cualquier entrada', () => {
    const entradas: unknown[] = [
      'TypeError',
      'AlgoQueNadieDeclaro',
      'Error: rafa@example.com',
      undefined,
      'A'.repeat(65),
    ]
    for (const entrada of entradas) {
      const unaVez = normalizeErrorName(entrada)
      expect(normalizeErrorName(unaVez)).toBe(unaVez)
    }
  })
})

describe('nombres reservados de integración', () => {
  // Los fallos de sync no traen objeto de error: su nombre lo declara el
  // puente. Tiene que estar en la allowlist o volvería como UnlistedName.
  it('reconoce SyncError como clase conocida', () => {
    expect(normalizeErrorName('SyncError')).toBe('SyncError')
  })
})
