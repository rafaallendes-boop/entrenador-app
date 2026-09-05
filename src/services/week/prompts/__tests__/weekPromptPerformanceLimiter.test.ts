import { describe, expect, it } from 'vitest'
import { buildWeekUserPrompt } from '../weekPrompt'
import { makeWeekPromptInput } from './fixtures'

describe('limitante físico en el prompt', () => {
  it('aparece como línea propia cuando está declarado', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({
      profile: { performanceLimiter: 'recuperación cardíaca entre puntos' },
    }))
    expect(prompt).toContain('Limitante de rendimiento a trabajar: recuperación cardíaca entre puntos')
  })

  it('no genera NINGUNA línea cuando está vacío', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({ profile: { performanceLimiter: undefined } }))
    expect(prompt).not.toContain('Limitante de rendimiento')
    expect(prompt).not.toContain('sin limitante')
  })

  it('trata una cadena en blanco como ausencia', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({ profile: { performanceLimiter: '   ' } }))
    expect(prompt).not.toContain('Limitante de rendimiento')
  })

  it('no se mezcla con la línea de lesiones/restricciones', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({
      profile: {
        performanceLimiter: 'recuperación cardíaca entre puntos',
        recoveryProfile: { currentInjuries: 'molestia lumbar leve' },
      },
    }))
    const limiterLine = prompt.split('\n').find((l) => l.includes('Limitante de rendimiento'))
    expect(limiterLine).toBeDefined()
    expect(limiterLine).not.toContain('lumbar')
  })
})
