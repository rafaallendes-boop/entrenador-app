import { describe, expect, it } from 'vitest'
import { BLOCKED_STRENGTH_COPY, blockedStrengthCopy } from '../strengthSafetyCopy'

describe('copy de bloqueo por restricción sin zona', () => {
  // Smoke de producción (2026-09-14): "No pude verificar… restricción
  // registrada" no decía qué faltaba ni cómo destrabarlo. Sin zona, lo único
  // accionable es pedirla.
  it('pide la zona en vez de hablar de una restricción registrada', () => {
    const copy = blockedStrengthCopy('unresolved_medical_restriction')
    expect(copy).toMatch(/zona/)
    expect(copy).toMatch(/espalda baja/)
    expect(copy).not.toMatch(/segur/i)
    expect(copy).not.toBe(BLOCKED_STRENGTH_COPY)
  })

  it('conserva el copy conservador para un pool insuficiente', () => {
    expect(blockedStrengthCopy('insufficient_safe_pool')).toBe(BLOCKED_STRENGTH_COPY)
  })
})
